import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Runs a Node script inside the server container of the dev stack and returns what it printed. */
export async function inServerContainer(script: string): Promise<string> {
  const { stdout } = await run(
    "docker",
    [
      "compose",
      "-f",
      resolve(ROOT, "docker-compose.dev.yml"),
      "exec",
      "-T",
      "server",
      "node",
      "-e",
      script,
    ],
    { cwd: ROOT, timeout: 30_000 },
  );
  return stdout.trim();
}
