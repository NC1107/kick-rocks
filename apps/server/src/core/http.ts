import {
  type IssueLocation,
  type RouteAuth,
  type RouteBody,
  type RouteDef,
  type RouteParams,
  type RouteQuery,
  type RouteResponse,
  toApiIssues,
} from "@kickrocks/shared";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { z } from "zod";
import { type DiskReserve, isDiskFull } from "./disk-reserve.js";
import { AppError, invalidRequest } from "./errors.js";

declare module "fastify" {
  interface FastifyContextConfig {
    /**
     * Who may call the route, set from the shared route table by `registerRoute` and
     * `registerNotImplemented`. The guard reads it, so the table is the one place that decides.
     */
    auth?: RouteAuth;
  }
}

interface BinaryReply {
  contentType: string;
  data: Buffer;
}

interface RouteContext<R extends RouteDef> {
  params: RouteParams<R>;
  query: RouteQuery<R>;
  body: RouteBody<R>;
  request: FastifyRequest;
  reply: FastifyReply;
}

type RouteResult<R extends RouteDef> = R extends { binary: readonly string[] }
  ? BinaryReply
  : RouteResponse<R>;

type RouteHandler<R extends RouteDef> = (
  context: RouteContext<R>,
) => RouteResult<R> | Promise<RouteResult<R>>;

function parseInput(
  schema: z.ZodType | undefined,
  value: unknown,
  location: IssueLocation,
): unknown {
  if (!schema) return undefined;
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw invalidRequest(`The request ${location} is invalid`, toApiIssues(parsed.error, location));
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
    config: { auth: route.auth },
    ...(route.bodyLimit === undefined ? {} : { bodyLimit: route.bodyLimit }),
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
export function installErrorHandling(
  app: FastifyInstance,
  reserve?: Pick<DiskReserve, "releaseOnFull">,
): void {
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof AppError) {
      if (error.retryAfterSeconds !== undefined) {
        void reply.header("Retry-After", String(error.retryAfterSeconds));
      }
      return reply.code(error.status).send({
        error: error.code,
        message: error.message,
        ...(error.issues ? { issues: error.issues } : {}),
        ...(error.retryAfterSeconds !== undefined
          ? { retryAfterSeconds: error.retryAfterSeconds }
          : {}),
      });
    }
    const status = (error as { statusCode?: number }).statusCode;
    if (status !== undefined && status >= 400 && status < 500) {
      return reply.code(status).send({
        error: CODE_BY_STATUS[status] ?? "invalid_request",
        message: error instanceof Error ? error.message : "The request could not be processed",
      });
    }
    if (isDiskFull(error)) {
      reserve?.releaseOnFull(error);
      request.log.error({ err: error }, "the disk is full");
      return reply.code(507).send({
        error: "disk_full",
        message:
          "The disk that holds the Kick Rocks data is full. Free some space on it, then try again.",
      });
    }
    request.log.error({ err: error }, "unhandled error");
    return reply.code(500).send({ error: "internal_error" });
  });
}

/**
 * The status and body for an error Fastify raised before routing, in the shape of the rest of the
 * API. The message is fixed, because Fastify's own text repeats the request path.
 */
export function frameworkErrorResponse(error: { statusCode?: number }): {
  status: number;
  body: { error: string; message?: string };
} {
  const status = error.statusCode !== undefined && error.statusCode < 500 ? error.statusCode : 500;
  if (status === 500) return { status, body: { error: "internal_error" } };
  return {
    status,
    body: {
      error: CODE_BY_STATUS[status] ?? "invalid_request",
      message: "The request could not be processed",
    },
  };
}
