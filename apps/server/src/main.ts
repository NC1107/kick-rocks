import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, openAppDatabase } from "./app.js";
import { loadConfig } from "./config.js";
import { createServices } from "./services.js";

function packageVersion(): string {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
}

async function main() {
  const config = loadConfig();
  const database = openAppDatabase(config);
  const services = createServices(config, database.db);
  const app = await buildApp({ services, database, version: packageVersion() });

  if (config.workerToken === null) {
    app.server.log.info("KICKROCKS_WORKER_TOKEN is not set; the worker API is off");
  }

  const shutdown = async (signal: string) => {
    app.server.log.info({ signal }, "shutting down");
    await app.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));

  await app.server.listen({ host: config.host, port: config.port });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
