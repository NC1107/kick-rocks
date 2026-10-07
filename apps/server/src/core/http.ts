import {
  type ApiIssue,
  type ApiModule,
  type RouteBody,
  type RouteDef,
  type RouteParams,
  type RouteQuery,
  type RouteResponse,
  routesOfModule,
} from "@kickrocks/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { AppError, invalidRequest } from "./errors.js";

export interface BinaryReply {
  contentType: string;
  data: Buffer;
}

export interface RouteContext<R extends RouteDef> {
  params: RouteParams<R>;
  query: RouteQuery<R>;
  body: RouteBody<R>;
  request: FastifyRequest;
  reply: FastifyReply;
}

type RouteResult<R extends RouteDef> = R extends { binary: readonly string[] }
  ? BinaryReply
  : RouteResponse<R>;

export type RouteHandler<R extends RouteDef> = (
  context: RouteContext<R>,
) => RouteResult<R> | Promise<RouteResult<R>>;

function toIssues(error: z.ZodError, location: string): ApiIssue[] {
  return error.issues.map((issue) => ({
    path: [location, ...issue.path.filter((p): p is string | number => typeof p !== "symbol")],
    message: issue.message,
  }));
}

function parseInput(schema: z.ZodType | undefined, value: unknown, location: string): unknown {
  if (!schema) return undefined;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw invalidRequest(`The request ${location} is invalid`, toIssues(parsed.error, location));
  }
  return parsed.data;
}

/**
 * Registers one route from the shared table. Params, query, and body are validated against the
 * route's schemas before the handler runs, and the response is parsed through its schema on the
 * way out, which also strips any field the contract does not name.
 */
export function registerRoute<R extends RouteDef>(
  app: FastifyInstance,
  route: R,
  handler: RouteHandler<R>,
): void {
  app.route({
    method: route.method,
    url: route.path,
    handler: async (request, reply) => {
      const result = await handler({
        params: parseInput(route.params, request.params, "params") as RouteParams<R>,
        query: parseInput(route.query, request.query, "query") as RouteQuery<R>,
        body: parseInput(route.body, request.body, "body") as RouteBody<R>,
        request,
        reply,
      });
      if (reply.sent) return reply;
      if (route.binary) {
        const { contentType, data } = result as BinaryReply;
        return reply.header("cache-control", "private, no-store").type(contentType).send(data);
      }
      return reply.code(route.status ?? 200).send(route.response?.parse(result));
    },
  });
}

/** Answers every route of a module with 501 until the module's own routes replace it. */
export function registerNotImplemented(app: FastifyInstance, module: ApiModule): void {
  for (const route of routesOfModule(module)) {
    app.route({
      method: route.method,
      url: route.path,
      handler: (_request, reply) =>
        reply.code(501).send({
          error: "not_implemented",
          message: `${route.method} ${route.path} is not implemented yet`,
        }),
    });
  }
}

const CODE_BY_STATUS: Record<number, string> = {
  400: "invalid_request",
  401: "unauthorized",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  413: "payload_too_large",
  415: "invalid_request",
  429: "rate_limited",
};

/** One error shape for the whole API: { error, message?, issues? }. */
export function installErrorHandling(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      return reply.code(error.status).send({
        error: error.code,
        message: error.message,
        ...(error.issues ? { issues: error.issues } : {}),
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.code(status).send({
        error: CODE_BY_STATUS[status] ?? "invalid_request",
        message: error instanceof Error ? error.message : "The request could not be processed",
      });
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ error: "internal_error" });
  });
}
