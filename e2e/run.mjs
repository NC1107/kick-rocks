import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Starts the development stack, runs the end-to-end suite against it, and stops the stack again.
// KICKROCKS_E2E_KEEP=1 leaves the containers running afterwards, for looking around by hand.
// KICKROCKS_E2E_NO_BUILD=1 reuses the images of an earlier run.

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compose = ["compose", "-f", resolve(root, "docker-compose.dev.yml")];
const keep = process.env.KICKROCKS_E2E_KEEP === "1";

function docker(args, options = {}) {
  return spawnSync("docker", [...compose, ...args], { cwd: root, stdio: "inherit", ...options });
}

function stop() {
  if (keep) {
    console.log("KICKROCKS_E2E_KEEP=1: the stack is still running. Stop it with:");
    console.log("  docker compose -f docker-compose.dev.yml down -v");
    return;
  }
  docker(["down", "--volumes", "--remove-orphans"]);
}

async function waitFor(url, what, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // not up yet
    }
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await new Promise((done) => setTimeout(done, 500));
  }
}

let exitCode = 1;
let stopped = false;
const stopOnce = () => {
  if (stopped) return;
  stopped = true;
  stop();
};
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    stopOnce();
    process.exit(130);
  });
}

try {
  // A previous run that was killed leaves a stack with old state behind.
  docker(["down", "--volumes", "--remove-orphans"], { stdio: "ignore" });
  const up = docker([
    "up",
    "-d",
    ...(process.env.KICKROCKS_E2E_NO_BUILD === "1" ? [] : ["--build"]),
    "--wait",
  ]);
  if (up.status !== 0) throw new Error("docker compose up failed");
  await waitFor("http://127.0.0.1:8520/api/health", "the server");
  await waitFor("http://127.0.0.1:8530/__admin/state", "the fixture site");

  const vitest = spawn(
    process.execPath,
    [
      resolve(root, "e2e/node_modules/vitest/vitest.mjs"),
      "run",
      "--config",
      "vitest.e2e.config.ts",
      ...process.argv.slice(2),
    ],
    { cwd: resolve(root, "e2e"), stdio: "inherit" },
  );
  exitCode = await new Promise((done) => vitest.on("exit", (code) => done(code ?? 1)));
  if (exitCode !== 0) {
    console.log("\nThe suite failed. Recent server and worker logs, errors and warnings only:");
    const logs = spawnSync(
      "docker",
      [...compose, "logs", "--no-log-prefix", "--tail", "400", "server", "worker"],
      {
        cwd: root,
        encoding: "utf8",
      },
    );
    const interesting = `${logs.stdout}${logs.stderr}`
      .split("\n")
      .filter((line) => /"level":(40|50|60)\b/.test(line) || /\s(WARN|ERROR)\s/.test(line));
    console.log(interesting.slice(-60).join("\n"));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
} finally {
  stopOnce();
}
process.exit(exitCode);
