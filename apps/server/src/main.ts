import { buildApp, openAppDatabase } from "./app.js";
import { loadConfig } from "./config.js";
import { systemClock } from "./core/clock.js";
import { packageVersion } from "./core/version.js";
import { resetPassword } from "./reset-password.js";
import { createServices } from "./services.js";

/** Just under Docker's ten seconds, for a close that hangs on something other than the scheduler. */
const SHUTDOWN_BACKSTOP_MS = 9_000;

async function main() {
  const config = loadConfig();
  const database = openAppDatabase(config);

  const [command] = process.argv.slice(2);
  if (command === "reset-password") {
    resetPassword(database.db, systemClock);
    database.close();
    console.log("The password and all sessions are cleared. Open the app to set a new password.");
    return;
  }
  if (command !== undefined) {
    database.close();
    throw new Error(`Unknown command "${command}". The only command is reset-password.`);
  }

  const services = createServices(config, database.db);
  const app = await buildApp({ services, database, version: packageVersion() });

  if (config.workerToken === null) {
    app.server.log.info("KICKROCKS_WORKER_TOKEN is not set; the worker API is off");
  }

  const shutdown = async (signal: string) => {
    app.server.log.info({ signal }, "shutting down");
    const backstop = setTimeout(() => {
      app.server.log.error("shutdown did not finish in time, so the process exits anyway");
      process.exit(1);
    }, SHUTDOWN_BACKSTOP_MS);
    backstop.unref();
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
