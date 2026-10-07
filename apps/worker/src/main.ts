import { WorkerApiClient } from "./api-client.js";
import { runClaimLoop } from "./claim-loop.js";
import { loadWorkerConfig } from "./config.js";

async function main() {
  const config = loadWorkerConfig();
  const client = new WorkerApiClient({
    serverUrl: config.serverUrl,
    token: config.token,
    workerId: config.workerId,
  });

  const shutdown = new AbortController();
  process.on("SIGINT", () => shutdown.abort());
  process.on("SIGTERM", () => shutdown.abort());

  await runClaimLoop({ config, client, signal: shutdown.signal });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
