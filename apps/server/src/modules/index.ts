import type { FastifyInstance } from "fastify";
import type { ModulePlugin } from "../core/module.js";
import type { AppServices } from "../services.js";
import { authModule } from "./auth/index.js";
import { campaignsModule } from "./campaigns/index.js";
import { dashboardModule } from "./dashboard/index.js";
import { mailboxModule } from "./mailbox/index.js";
import { mcpModule } from "./mcp/index.js";
import { profilesModule } from "./profiles/index.js";
import { recipesModule } from "./recipes/index.js";
import { requestsModule } from "./requests/index.js";
import { reviewModule } from "./review/index.js";
import { scansModule } from "./scans/index.js";
import { settingsModule } from "./settings/index.js";
import { targetsModule } from "./targets/index.js";
import { workerApiModule } from "./worker-api/index.js";

interface ModuleRegistration {
  name: string;
  plugin: ModulePlugin;
  prefix: "/api" | "/mcp";
}

export const MODULES: readonly ModuleRegistration[] = [
  { name: "auth", plugin: authModule, prefix: "/api" },
  { name: "profiles", plugin: profilesModule, prefix: "/api" },
  { name: "settings", plugin: settingsModule, prefix: "/api" },
  { name: "mailbox", plugin: mailboxModule, prefix: "/api" },
  { name: "targets", plugin: targetsModule, prefix: "/api" },
  { name: "campaigns", plugin: campaignsModule, prefix: "/api" },
  { name: "requests", plugin: requestsModule, prefix: "/api" },
  { name: "dashboard", plugin: dashboardModule, prefix: "/api" },
  { name: "scans", plugin: scansModule, prefix: "/api" },
  { name: "review", plugin: reviewModule, prefix: "/api" },
  { name: "worker-api", plugin: workerApiModule, prefix: "/api" },
  { name: "recipes", plugin: recipesModule, prefix: "/api" },
  { name: "mcp", plugin: mcpModule, prefix: "/mcp" },
];

/** Each module gets its own encapsulated scope, so its hooks and decorators stay its own. */
export async function registerModules(app: FastifyInstance, services: AppServices): Promise<void> {
  for (const { plugin, prefix } of MODULES) {
    await app.register(async (scope) => plugin(scope, services), { prefix });
  }
}
