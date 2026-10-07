import { describe, expect, it } from "vitest";
import { BROWSER_TASK_KINDS } from "./tasks.js";
import {
  AGENT_DEFAULT_KINDS,
  TaskCompleteBody,
  TaskReleaseBody,
  WORKER_DEFAULT_KINDS,
  WorkerClaimBody,
} from "./worker.js";

describe("claim defaults", () => {
  it("keeps the built-in worker off agent tasks and an agent off recipe tasks", () => {
    expect([...WORKER_DEFAULT_KINDS]).toEqual(["scan", "form", "confirm", "canary"]);
    expect([...AGENT_DEFAULT_KINDS]).toEqual(["agent"]);
    expect([...WORKER_DEFAULT_KINDS, ...AGENT_DEFAULT_KINDS].sort()).toEqual(
      [...BROWSER_TASK_KINDS].sort(),
    );
  });

  it("applies the worker default when a worker does not say what it can run", () => {
    expect(WorkerClaimBody.parse({ workerId: "w" }).kinds).toEqual([...WORKER_DEFAULT_KINDS]);
    expect(WorkerClaimBody.parse({ workerId: "w", kinds: ["agent"] }).kinds).toEqual(["agent"]);
    expect(WorkerClaimBody.safeParse({ workerId: "w", kinds: [] }).success).toBe(false);
  });

  it("counts a worker as the built-in one unless it says it drives a model", () => {
    expect(WorkerClaimBody.parse({ workerId: "w" }).claimer).toBe("builtin");
    expect(WorkerClaimBody.parse({ workerId: "w", claimer: "model" }).claimer).toBe("model");
    expect(WorkerClaimBody.safeParse({ workerId: "w", claimer: "mcp" }).success).toBe(false);
  });
});

describe("completing and releasing", () => {
  it("lets a worker report what a run cost", () => {
    expect(
      TaskCompleteBody.parse({ workerId: "w", result: {}, usage: { durationMs: 5 } }).usage,
    ).toEqual({ durationMs: 5 });
  });

  it("bounds how long a released task is held back", () => {
    expect(TaskReleaseBody.safeParse({ workerId: "w", retryAfterMs: 60_000 }).success).toBe(true);
    expect(TaskReleaseBody.safeParse({ workerId: "w", retryAfterMs: 1e12 }).success).toBe(false);
  });
});
