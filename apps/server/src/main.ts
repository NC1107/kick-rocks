import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp, openAppDatabase } from "./app.js";
import { loadConfig } from "./config.js";

function packageVersion(): string {
  const file = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
  return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
}

async function main() {
  const config = loadConfig();
  const database = openAppDatabase(config);
  const app = await buildApp({ config, database, version: packageVersion() });

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
