import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { STACK } from "./stack.js";

/** An MCP client the way Claude Code or any agent connects: streamable HTTP with the bearer token. */
export async function connectMcp(token: string): Promise<Client> {
  const transport = new StreamableHTTPClientTransport(new URL(`${STACK.serverUrl}/mcp`), {
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "kickrocks-e2e", version: "0.0.0" });
  await client.connect(transport);
  return client;
}

/** The structured content of a tool call, or its text parsed as JSON, and a failure when the tool reported one. */
export async function callTool<T = unknown>(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    throw new Error(`MCP tool ${name} failed: ${JSON.stringify(result.content)}`);
  }
  if (result.structuredContent !== undefined) return result.structuredContent as T;
  const text = (result.content as { type: string; text?: string }[]).find(
    (part) => part.type === "text",
  )?.text;
  return JSON.parse(text ?? "null") as T;
}
