import { type ChildProcess, fork } from "node:child_process";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import type { ReplyClassification, ReplyModelStatus } from "@kickrocks/shared";
import { encoderText, type ModelInput } from "./input.js";
import { type ReplyModelManifest, readManifest } from "./manifest.js";
import { availableMemory, MODEL_MEMORY_BYTES } from "./memory.js";
import type { FromWorker, ToWorker } from "./protocol.js";
import type { ModelResult, ReplyModelHost } from "./types.js";

const REQUEST_TIMEOUT_MS = 10_000;
/** A cold disk can take seconds to give up 571 MB, and the files are hashed first. */
const LOAD_TIMEOUT_MS = 90_000;
const IDLE_MS = 3 * 60 * 1000;
const MAX_THREADS = 4;

export interface ReplyModelHostOptions {
  /** The folder holding the manifest and the model files. Null means no model is installed. */
  dir: string | null;
  log?: (message: string) => void;
  idleMs?: number;
  requestTimeoutMs?: number;
  loadTimeoutMs?: number;
  minFreeBytes?: number;
  availableMemory?: () => number;
  threads?: number;
  /** Replaces the child's script, which tests point at a stand-in. */
  workerPath?: string;
}

function workerScript(override: string | undefined): { path: string; execArgv: string[] } {
  if (override) return { path: override, execArgv: [] };
  const compiled = fileURLToPath(new URL("./worker.js", import.meta.url));
  if (existsSync(compiled)) return { path: compiled, execArgv: [] };
  // Running from source, as `pnpm dev` and the tests do.
  return {
    path: fileURLToPath(new URL("./worker.ts", import.meta.url)),
    execArgv: ["--import", "tsx"],
  };
}

function mebibytes(bytes: number): number {
  return Math.round(bytes / 1024 ** 2);
}

/**
 * Runs the reply model in a child process, started on the first reply that needs it and stopped
 * after it has been idle for a while. It answers one reply at a time. A crash, a timeout or too
 * little free memory costs only that reply its model answer.
 */
export function createReplyModelHost(options: ReplyModelHostOptions): ReplyModelHost {
  const idleMs = options.idleMs ?? IDLE_MS;
  const requestTimeoutMs = options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS;
  const loadTimeoutMs = options.loadTimeoutMs ?? LOAD_TIMEOUT_MS;
  const minFree = options.minFreeBytes ?? MODEL_MEMORY_BYTES;
  const freeMemory = options.availableMemory ?? availableMemory;
  const threads = options.threads ?? Math.min(MAX_THREADS, availableParallelism());
  const logged = new Set<string>();

  let child: ChildProcess | null = null;
  let idleTimer: NodeJS.Timeout | null = null;
  let loadFailure: string | null = null;
  let nextId = 1;
  let queue: Promise<unknown> = Promise.resolve();

  const logOnce = (reason: string) => {
    if (logged.has(reason)) return;
    logged.add(reason);
    options.log?.(reason);
  };

  function stopChild(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = null;
    const running = child;
    child = null;
    if (running && running.exitCode === null) running.kill("SIGKILL");
  }

  function armIdle(): void {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(stopChild, idleMs);
    idleTimer.unref();
  }

  /** Resolves with the first message the child sends that `pick` accepts, or says why it never came. */
  function receive<T>(
    running: ChildProcess,
    pick: (message: FromWorker) => T | undefined,
    timeoutMs: number,
    what: string,
  ): Promise<{ ok: true; value: T } | { ok: false; reason: string }> {
    return new Promise((resolve) => {
      const finish = (outcome: { ok: true; value: T } | { ok: false; reason: string }) => {
        clearTimeout(timer);
        running.off("message", onMessage);
        running.off("exit", onExit);
        resolve(outcome);
      };
      const onMessage = (message: FromWorker) => {
        const picked = pick(message);
        if (picked !== undefined) finish({ ok: true, value: picked });
      };
      const onExit = () => finish({ ok: false, reason: `The reply model stopped while ${what}` });
      const timer = setTimeout(() => {
        stopChild();
        finish({
          ok: false,
          reason: `The reply model took longer than ${Math.round(timeoutMs / 1000)} s ${what}`,
        });
      }, timeoutMs);
      running.on("message", onMessage);
      running.once("exit", onExit);
    });
  }

  async function start(
    dir: string,
    manifest: ReplyModelManifest,
  ): Promise<{ ok: true; child: ChildProcess } | { ok: false; reason: string }> {
    if (child && child.exitCode === null && child.connected) return { ok: true, child };
    const free = freeMemory();
    if (free < minFree) {
      return {
        ok: false,
        reason: `Not enough free memory for the reply model (${mebibytes(free)} MiB free, ${mebibytes(minFree)} MiB needed)`,
      };
    }
    const script = workerScript(options.workerPath);
    const running = fork(script.path, [], {
      execArgv: script.execArgv,
      // The runtime ships Microsoft's usage telemetry on Linux, and nothing here may leave the machine.
      env: { ...process.env, ORT_DISABLE_TELEMETRY: "1" },
      stdio: ["ignore", "inherit", "inherit", "ipc"],
    });
    child = running;
    running.once("exit", () => {
      if (child === running) child = null;
    });
    const loading = receive(
      running,
      (message) =>
        message.type === "ready"
          ? { failed: null }
          : message.type === "failed"
            ? { failed: message.message }
            : undefined,
      loadTimeoutMs,
      "loading",
    );
    running.send({ type: "load", dir, threads, manifest } satisfies ToWorker);
    const loaded = await loading;
    if (!loaded.ok) {
      stopChild();
      return loaded;
    }
    if (loaded.value.failed !== null) {
      // The files are wrong or the runtime refuses them, which a retry will not change.
      loadFailure = loaded.value.failed;
      stopChild();
      return { ok: false, reason: loaded.value.failed };
    }
    loadFailure = null;
    return { ok: true, child: running };
  }

  async function answer(input: ModelInput): Promise<ModelResult> {
    if (!options.dir) return { ok: false, reason: "No reply model is installed" };
    const read = readManifest(options.dir);
    if (!read.ok) return { ok: false, reason: read.reason };
    const manifest = read.manifest;

    const started = await start(options.dir, manifest);
    if (!started.ok) return started;
    const running = started.child;
    const id = nextId++;
    const waiting = receive(
      running,
      (message) =>
        message.type === "result" && message.id === id
          ? { probabilities: message.probabilities }
          : message.type === "error" && message.id === id
            ? { error: message.message }
            : undefined,
      requestTimeoutMs,
      "answering",
    );
    running.send({ type: "predict", id, text: encoderText(input) } satisfies ToWorker);
    const reply = await waiting;
    armIdle();
    if (!reply.ok) return reply;
    if ("error" in reply.value)
      return { ok: false, reason: `The reply model failed: ${reply.value.error}` };
    return fromProbabilities(manifest, reply.value.probabilities);
  }

  return {
    predict(input) {
      const run = queue.then(() => answer(input));
      queue = run.catch(() => undefined);
      return run
        .catch(
          (error): ModelResult => ({
            ok: false,
            reason: `The reply model failed: ${error instanceof Error ? error.message : String(error)}`,
          }),
        )
        .then((result) => {
          if (!result.ok) logOnce(result.reason);
          return result;
        });
    },

    status(): ReplyModelStatus {
      if (!options.dir)
        return { state: "not_installed", reason: null, version: null, threshold: null };
      const read = readManifest(options.dir);
      if (!read.ok) {
        return {
          state: read.state,
          reason: read.state === "failed" ? read.reason : null,
          version: null,
          threshold: null,
        };
      }
      if (loadFailure) {
        return {
          state: "failed",
          reason: loadFailure,
          version: read.manifest.version,
          threshold: null,
        };
      }
      return {
        state: "loaded",
        reason: null,
        version: read.manifest.version,
        threshold: read.manifest.threshold,
      };
    },

    async close() {
      stopChild();
      await queue;
    },
  };
}

function fromProbabilities(manifest: ReplyModelManifest, probabilities: number[]): ModelResult {
  if (probabilities.length !== manifest.labels.length) {
    return { ok: false, reason: "The reply model returned the wrong number of scores" };
  }
  const byName = {} as Record<ReplyClassification, number>;
  let best = 0;
  manifest.labels.forEach((label, index) => {
    const value = probabilities[index] as number;
    byName[label] = value;
    if (value > (probabilities[best] as number)) best = index;
  });
  return {
    ok: true,
    answer: {
      label: manifest.labels[best] as ReplyClassification,
      confidence: probabilities[best] as number,
      probabilities: byName,
      version: manifest.version,
      manifestThreshold: manifest.threshold,
    },
  };
}
