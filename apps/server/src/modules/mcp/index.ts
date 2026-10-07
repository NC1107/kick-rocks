import { SCREENSHOT_BODY_LIMIT_BYTES } from "@kickrocks/shared";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { FastifyReply, FastifyRequest } from "fastify";
import { createHostPolicy, type HostPolicy } from "../../core/hosts.js";
import type { ModulePlugin } from "../../core/module.js";
import { packageVersion } from "../../core/version.js";
import { createMcpServer } from "./server.js";

/** The one place a body that is not JSON can be told apart from one that is. */
const NOT_JSON = Symbol("not-json");

const FORWARDED_HEADERS = ["accept", "content-type", "mcp-protocol-version", "mcp-session-id"];

function jsonRpcError(code: number, message: string) {
  return { jsonrpc: "2.0", error: { code, message }, id: null };
}

/**
 * A browser page can be pointed at this server by DNS rebinding, and then names the attacker's own
 * domain as both Host and Origin, so an Origin is judged against the names this server answers to
 * and never against the Host header. A client that is not a browser sends no Origin and is not
 * affected. The bearer token is the real gate; this is the second one the MCP transport spec asks for.
 */
function originAllowed(request: FastifyRequest, hostAllowed: HostPolicy): boolean {
  const origin = request.headers.origin;
  if (origin === undefined) return true;
  try {
    return hostAllowed(new URL(origin).host);
  } catch {
    return false;
  }
}

function toWebRequest(request: FastifyRequest): Request {
  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = request.headers[name];
    if (typeof value === "string") headers.set(name, value);
  }
  return new Request("http://localhost/mcp", { method: request.method, headers });
}

async function relay(reply: FastifyReply, response: Response): Promise<FastifyReply> {
  reply.code(response.status);
  response.headers.forEach((value, name) => {
    reply.header(name, value);
  });
  const body = Buffer.from(await response.arrayBuffer());
  return reply.send(body.byteLength > 0 ? body : undefined);
}

/**
 * Mounted at /mcp. The server is stateless: every POST builds its own MCP server and transport, and
 * answers with plain JSON instead of an event stream. Nothing is held between calls but the task
 * lease in the database, which is what an agent works against, so a restart or a proxy that drops
 * connections cannot strand a client in a session that no longer exists.
 */
export const mcpModule: ModulePlugin = (app, services) => {
  const version = packageVersion();
  const hostAllowed = createHostPolicy(services.config);

  // The default parser answers a malformed body with a REST error, which an MCP client cannot
  // read. This one hands the route a marker, so the route can answer in JSON-RPC.
  app.removeContentTypeParser("application/json");
  app.addContentTypeParser("application/json", { parseAs: "string" }, (_request, body, done) => {
    try {
      done(null, JSON.parse(body as string));
    } catch {
      done(null, NOT_JSON);
    }
  });

  app.post("/", { bodyLimit: SCREENSHOT_BODY_LIMIT_BYTES }, async (request, reply) => {
    if (!originAllowed(request, hostAllowed)) {
      return reply.code(403).send(jsonRpcError(-32000, "Origin not allowed"));
    }
    if (request.body === NOT_JSON) {
      return reply.code(400).send(jsonRpcError(-32700, "Parse error: the body is not JSON"));
    }
    const server = createMcpServer(services, version);
    const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
    try {
      await server.connect(transport);
      const response = await transport.handleRequest(toWebRequest(request), {
        parsedBody: request.body,
      });
      return await relay(reply, response);
    } finally {
      await server.close();
    }
  });

  // There are no server-initiated messages and no sessions to end, so there is no stream to open
  // and nothing to delete. 405 is what the spec says a server without a stream answers.
  const methodNotAllowed = (_request: FastifyRequest, reply: FastifyReply) =>
    reply
      .code(405)
      .header("allow", "POST")
      .send(jsonRpcError(-32000, "Method not allowed: this server is stateless, use POST"));
  app.get("/", methodNotAllowed);
  app.delete("/", methodNotAllowed);
};
