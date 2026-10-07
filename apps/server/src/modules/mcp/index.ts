import type { ModulePlugin } from "../../core/module.js";

/** Mounted at /mcp. Module E replaces the stub with the streamable HTTP MCP server. */
export const mcpModule: ModulePlugin = (app) => {
  app.all("/", (_request, reply) =>
    reply
      .code(501)
      .send({ error: "not_implemented", message: "The MCP server is not implemented yet" }),
  );
};
