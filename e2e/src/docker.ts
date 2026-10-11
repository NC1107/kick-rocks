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

const WITH_AGENT = ["compose", "-f", resolve(ROOT, "docker-compose.dev.yml"), "--profile", "agent"];

/** Starts the agent worker of the dev stack, which the default stack leaves out. */
export async function startAgentWorker(): Promise<void> {
  await run("docker", [...WITH_AGENT, "up", "-d", "--no-build", "agent-worker"], {
    cwd: ROOT,
    timeout: 120_000,
  });
}

/** Stops and removes the agent worker so it never claims a task of a later journey. */
export async function stopAgentWorker(): Promise<void> {
  await run("docker", [...WITH_AGENT, "rm", "--stop", "--force", "agent-worker"], {
    cwd: ROOT,
    timeout: 60_000,
  });
}
