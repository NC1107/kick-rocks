import type { ClaimedTask } from "@kickrocks/shared";
import { WorkerApiError } from "@kickrocks/worker/dist/api-client.js";
import { SubmitNotRecorded, type TaskReport } from "@kickrocks/worker/dist/executor.js";
import { describe, expect, it, vi } from "vitest";
import { agentTask, silentLogger, summary } from "../test/support.js";
import { type AgentApi, type AgentExecutor, type LoopTiming, runLoop } from "./loop.js";

const FAST: Partial<LoopTiming> = {
  leaseHeartbeatMs: 20,
  idleHeartbeatMs: 10_000,
  shutdownGraceMs: 50,
  maxBackoffMs: 20,
  reportAttempts: 3,
  reportRetryMs: 1,
};

function fakeApi(tasks: (ClaimedTask | null | Error)[]) {
  const queue = [...tasks];
  const api = {
    heartbeat: vi.fn<AgentApi["heartbeat"]>(async () => ({
      ok: true as const,
      serverTime: "2026-10-07T00:00:00.000Z",
    })),
    claim: vi.fn(async () => {
      const next = queue.shift();
      if (next instanceof Error) throw next;
      return next ?? null;
    }),
    taskHeartbeat: vi.fn(async () => ({ leaseExpiresAt: "2026-10-07T00:10:00.000Z" })),
    complete: vi.fn(async (id: string) => summary(id)),
    block: vi.fn(async (id: string) => summary(id)),
    fail: vi.fn(async (id: string) => summary(id)),
    release: vi.fn(async (id: string) => summary(id)),
  };
  return api satisfies AgentApi;
}

async function drive(
  api: AgentApi,
  executor: AgentExecutor,
  until: () => boolean,
  extra: { forceStop?: () => Promise<void>; signal?: AbortController } = {},
): Promise<void> {
  const controller = extra.signal ?? new AbortController();
  const finished = runLoop({
    api,
    executor,
    signal: controller.signal,
    logger: silentLogger,
    workerId: "test-agent",
    pollMs: 5,
    leaseMs: 60_000,
    timing: FAST,
    ...(extra.forceStop ? { forceStop: extra.forceStop } : {}),
  });
  await vi.waitUntil(until, { timeout: 5_000, interval: 5 });
  controller.abort();
  await finished;
}

describe("the agent claim loop", () => {
  it("claims only agent tasks, runs one, and reports the result with its usage", async () => {
    const task = agentTask();
    const api = fakeApi([task]);
    const usage = { inputTokens: 10, outputTokens: 5, durationMs: 100 };
    const executor: AgentExecutor = async () => ({ kind: "complete", result: { ok: 1 }, usage });
    await drive(api, executor, () => api.complete.mock.calls.length > 0);

    expect(api.claim).toHaveBeenCalledWith(["agent"], 60_000);
    expect(api.complete).toHaveBeenCalledWith(task.id, { ok: 1 }, usage, undefined);
  });

  it("reports a block with its screenshot, a failure, and a release", async () => {
    const tasks = [agentTask(), agentTask(), agentTask()];
    const api = fakeApi(tasks);
    const reports = [
      { kind: "block" as const, report: { reason: "captcha" as const, detail: "reCAPTCHA" } },
      { kind: "fail" as const, report: { error: "down", retryable: true, kind: "site" as const } },
      { kind: "release" as const, reason: "later", retryAfterMs: 5000 },
    ];
    let n = 0;
    await drive(
      api,
      async () => reports[n++] as never,
      () => api.release.mock.calls.length > 0,
    );

    expect(api.block).toHaveBeenCalledWith(tasks[0]?.id, reports[0]?.report);
    expect(api.fail).toHaveBeenCalledWith(tasks[1]?.id, (reports[1] as { report: unknown }).report);
    expect(api.release).toHaveBeenCalledWith(tasks[2]?.id, 5000);
  });

  it("keeps polling while the queue is empty, and sends the idle heartbeat", async () => {
    const api = fakeApi([null, null, null]);
    await drive(
      api,
      async () => ({ kind: "release", reason: "x" }),
      () => api.claim.mock.calls.length >= 3,
    );
    expect(api.heartbeat).toHaveBeenCalledWith({ busy: false, currentTaskId: null });
  });

  it("backs off after a failed claim and then carries on", async () => {
    const api = fakeApi([new WorkerApiError(503, "unavailable", "down"), agentTask()]);
    await drive(
      api,
      async () => ({ kind: "release", reason: "x" }),
      () => api.release.mock.calls.length > 0,
    );
    expect(api.claim.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps the lease alive while the model works", async () => {
    const api = fakeApi([agentTask()]);
    const executor: AgentExecutor = async () => {
      await vi.waitUntil(() => api.taskHeartbeat.mock.calls.length >= 2, {
        timeout: 2000,
        interval: 5,
      });
      return { kind: "release", reason: "done" };
    };
    await drive(api, executor, () => api.release.mock.calls.length > 0);
    expect(api.taskHeartbeat).toHaveBeenCalledWith(expect.any(String), 60_000);
  });

  it("stops the run and drops its result when the task is taken away", async () => {
    const api = fakeApi([agentTask()]);
    api.taskHeartbeat.mockRejectedValue(new WorkerApiError(409, "lease_not_held", "taken"));
    let seen: AbortSignal | undefined;
    const executor: AgentExecutor = async (_task, signal) => {
      seen = signal;
      await vi.waitUntil(() => signal.aborted, { timeout: 2000, interval: 5 });
      return { kind: "fail", report: { error: "aborted", retryable: true } };
    };
    await drive(api, executor, () => seen?.aborted === true);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(api.fail).not.toHaveBeenCalled();
    expect(api.complete).not.toHaveBeenCalled();
  });

  it("finishes the run and reports it when only the lease ran out", async () => {
    const api = fakeApi([agentTask()]);
    api.taskHeartbeat.mockRejectedValue(new WorkerApiError(409, "lease_expired", "late"));
    const executor: AgentExecutor = async () => {
      await vi.waitUntil(() => api.taskHeartbeat.mock.calls.length >= 1, {
        timeout: 2000,
        interval: 5,
      });
      return { kind: "complete", result: { late: true }, usage: {} };
    };
    await drive(api, executor, () => api.complete.mock.calls.length > 0);
    expect(api.complete).toHaveBeenCalled();
  });

  it("turns a result the server rejects into a failure that is not retried", async () => {
    const api = fakeApi([agentTask()]);
    api.complete.mockRejectedValue(new WorkerApiError(400, "invalid_result", "outcome is wrong"));
    await drive(
      api,
      async () => ({ kind: "complete", result: {}, usage: { inputTokens: 7 } }),
      () => api.fail.mock.calls.length > 0,
    );
    expect(api.fail).toHaveBeenCalledWith(expect.any(String), {
      error: "The server rejected the result: outcome is wrong",
      retryable: false,
      kind: "internal",
      usage: { inputTokens: 7 },
    });
  });

  it("retries a report the server could not take, and gives up on one it refuses", async () => {
    const api = fakeApi([agentTask(), agentTask()]);
    api.release
      .mockRejectedValueOnce(new WorkerApiError(502, "bad_gateway", "x"))
      .mockRejectedValueOnce(new Error("socket hang up"));
    api.block.mockRejectedValue(new WorkerApiError(400, "invalid_screenshot", "bad"));
    const reports = [
      { kind: "release" as const, reason: "r" },
      { kind: "block" as const, report: { reason: "unknown" as const } },
    ];
    let n = 0;
    await drive(
      api,
      async () => reports[n++] as never,
      () => api.block.mock.calls.length > 0,
    );
    expect(api.release).toHaveBeenCalledTimes(3);
    expect(api.block).toHaveBeenCalledTimes(1);
  });

  it("keeps sending a result through an outage that outlasts the tries a report that can wait gets", async () => {
    const api = fakeApi([agentTask()]);
    for (let i = 0; i < 12; i++) api.complete.mockRejectedValueOnce(new TypeError("fetch failed"));
    await drive(
      api,
      async () => ({ kind: "complete", result: {}, usage: {} }) as never,
      () => api.complete.mock.calls.length >= 13,
    );
    expect(api.complete).toHaveBeenCalledTimes(13);
  });

  it("gives up on a result the server keeps answering with an error and claims the next task", async () => {
    const api = fakeApi([agentTask(), { ...agentTask(), id: "second" }]);
    api.complete.mockRejectedValue(new WorkerApiError(500, "internal", "boom"));
    await drive(
      api,
      async () => ({ kind: "complete", result: {}, usage: {} }) as never,
      () => api.complete.mock.calls.some(([id]) => id === "second"),
    );
    expect(api.complete.mock.calls.filter(([id]) => id !== "second")).toHaveLength(3);
  });

  it("keeps telling the server it is alive while a result waits for the server to come back", async () => {
    const api = fakeApi([agentTask()]);
    for (let i = 0; i < 12; i++) api.complete.mockRejectedValueOnce(new TypeError("fetch failed"));
    const controller = new AbortController();
    const finished = runLoop({
      api,
      executor: async () => ({ kind: "complete", result: {}, usage: {} }) as never,
      signal: controller.signal,
      logger: silentLogger,
      workerId: "test-agent",
      pollMs: 5,
      leaseMs: 60_000,
      timing: { ...FAST, idleHeartbeatMs: 1, reportRetryMs: 5 },
    });
    await vi.waitUntil(() => api.complete.mock.calls.length >= 13, { timeout: 5_000, interval: 5 });
    controller.abort();
    await finished;
    const busyBeats = api.heartbeat.mock.calls.filter(([beat]) => beat.busy);
    expect(busyBeats.length).toBeGreaterThan(3);
  });

  it("does not retry a report for a task that is no longer ours", async () => {
    const api = fakeApi([agentTask()]);
    api.fail.mockRejectedValue(new WorkerApiError(409, "lease_not_held", "gone"));
    await drive(
      api,
      async () => ({ kind: "fail", report: { error: "x", retryable: false } }),
      () => api.fail.mock.calls.length > 0,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.fail).toHaveBeenCalledTimes(1);
  });

  it("reports a failure when the executor throws", async () => {
    const api = fakeApi([agentTask()]);
    await drive(
      api,
      async () => {
        throw new Error("page exploded");
      },
      () => api.fail.mock.calls.length > 0,
    );
    expect(api.fail).toHaveBeenCalledWith(expect.any(String), {
      error: "page exploded",
      retryable: true,
      kind: "internal",
    });
  });

  it("asks a run to stop on shutdown, and hands its task back", async () => {
    const controller = new AbortController();
    const api = fakeApi([agentTask()]);
    const executor: AgentExecutor = async (_task, signal) => {
      controller.abort();
      await vi.waitUntil(() => signal.aborted, { timeout: 2000, interval: 5 });
      return { kind: "release", reason: "the worker is shutting down" };
    };
    await drive(api, executor, () => api.release.mock.calls.length > 0, { signal: controller });
    expect(api.release).toHaveBeenCalledWith(expect.any(String), undefined);
  });

  async function stalledShutdown(report: TaskReport, api = fakeApi([agentTask()])) {
    const controller = new AbortController();
    let unblock: () => void = () => undefined;
    const forceStop = vi.fn(async () => unblock());
    const executor: AgentExecutor = () =>
      new Promise((resolve) => {
        controller.abort();
        unblock = () => resolve(report);
      });
    const transitions = () =>
      [api.release, api.block, api.fail, api.complete].flatMap((m) => m.mock.calls);
    await drive(api, executor, () => transitions().length > 0, { signal: controller, forceStop });
    expect(forceStop).toHaveBeenCalled();
    return api;
  }

  it("spaces out the tries of a result it reports while stopping instead of making them at once", async () => {
    const controller = new AbortController();
    const api = fakeApi([agentTask()]);
    const stamps: number[] = [];
    api.complete.mockImplementation(async () => {
      stamps.push(Date.now());
      throw new TypeError("fetch failed");
    });
    const executor: AgentExecutor = async () => {
      controller.abort();
      return { kind: "complete", result: {}, usage: {} };
    };
    const finished = runLoop({
      api,
      executor,
      signal: controller.signal,
      logger: silentLogger,
      workerId: "test-agent",
      pollMs: 5,
      leaseMs: 60_000,
      timing: { ...FAST, shutdownGraceMs: 1_000, reportRetryMs: 40, maxBackoffMs: 200 },
    });
    await finished;
    expect(stamps).toHaveLength(3);
    expect(stamps.map((at, i) => at - (stamps[i - 1] ?? at)).slice(1)).toEqual([
      expect.toSatisfy((gap: number) => gap >= 35),
      expect.toSatisfy((gap: number) => gap >= 70),
    ]);
  });

  it("closes the browser and releases the task when a run ignores the shutdown", async () => {
    const api = await stalledShutdown({ kind: "fail", report: { error: "x", retryable: true } });
    expect(api.release).toHaveBeenCalled();
    expect(api.fail).not.toHaveBeenCalled();
  });

  it("keeps a block that the stopped run reached", async () => {
    const report = { reason: "unknown" as const, detail: "may already have been submitted" };
    const api = await stalledShutdown({ kind: "block", report });
    expect(api.block).toHaveBeenCalledWith(expect.any(String), report);
    expect(api.release).not.toHaveBeenCalled();
  });

  it("keeps a result and a failure that will not be retried", async () => {
    const done = await stalledShutdown({ kind: "complete", result: { late: true }, usage: {} });
    expect(done.complete).toHaveBeenCalled();
    expect(done.release).not.toHaveBeenCalled();
    const failed = await stalledShutdown({
      kind: "fail",
      report: { error: "x", retryable: false },
    });
    expect(failed.fail).toHaveBeenCalled();
    expect(failed.release).not.toHaveBeenCalled();
  });

  it("gives back a task that is not an agent task without running it", async () => {
    const wrong = { ...agentTask(), kind: "form" } as unknown as ClaimedTask;
    const api = fakeApi([wrong]);
    const executor = vi.fn<AgentExecutor>();
    await drive(api, executor, () => api.release.mock.calls.length > 0);
    expect(executor).not.toHaveBeenCalled();
    expect(api.release).toHaveBeenCalledWith(wrong.id, 60_000);
  });

  it("tells the server a removal may have been submitted before the run goes on, and with every later beat", async () => {
    const api = fakeApi([agentTask()]);
    const executor: AgentExecutor = async (_task, _signal, progress) => {
      expect(api.taskHeartbeat).not.toHaveBeenCalledWith(expect.any(String), 60_000, true);
      await progress?.mayHaveSubmitted();
      await progress?.mayHaveSubmitted();
      const calls = api.taskHeartbeat.mock.calls as unknown[][];
      expect(calls.filter((call) => call[2] === true)).toHaveLength(1);
      const before = calls.length;
      await vi.waitUntil(() => api.taskHeartbeat.mock.calls.length > before + 1, {
        timeout: 2000,
        interval: 5,
      });
      for (const call of calls.slice(before))
        expect(call).toEqual([expect.any(String), 60_000, true]);
      return { kind: "complete", result: {}, usage: {} };
    };
    await drive(api, executor, () => api.complete.mock.calls.length > 0);
    expect(api.complete).toHaveBeenCalled();
  });

  it.each([
    ["a 503", () => new WorkerApiError(503, "unavailable", "down")],
    ["a network error", () => new TypeError("fetch failed")],
    ["a lease that is no longer ours", () => new WorkerApiError(409, "lease_not_held", "taken")],
    ["a lease that lapsed", () => new WorkerApiError(409, "lease_expired", "lapsed")],
  ])("does not let the run click when the flagged heartbeat meets %s", async (_name, makeError) => {
    const api = fakeApi([agentTask()]);
    api.taskHeartbeat.mockImplementation((async (_id: string, _lease: number, flag?: boolean) => {
      if (flag) throw makeError();
      return { leaseExpiresAt: "2026-10-07T00:10:00.000Z" };
    }) as never);
    let clicked = false;
    let refusal: unknown;
    let ran = false;
    const executor: AgentExecutor = async (_task, _signal, progress) => {
      try {
        await progress?.mayHaveSubmitted();
        clicked = true;
      } catch (error) {
        refusal = error;
      }
      ran = true;
      return { kind: "release", reason: "not recorded" };
    };
    await drive(api, executor, () => ran);
    expect(clicked).toBe(false);
    expect(refusal).toBeInstanceOf(SubmitNotRecorded);
  });

  it("retries a flagged heartbeat that failed in passing, and lets the click through once it is acknowledged", async () => {
    const api = fakeApi([agentTask()]);
    let failures = 1;
    api.taskHeartbeat.mockImplementation((async (_id: string, _lease: number, flag?: boolean) => {
      if (flag && failures-- > 0) throw new WorkerApiError(503, "unavailable", "down");
      return { leaseExpiresAt: "2026-10-07T00:10:00.000Z" };
    }) as never);
    let clicked = false;
    const executor: AgentExecutor = async (_task, _signal, progress) => {
      await progress?.mayHaveSubmitted();
      clicked = true;
      return { kind: "complete", result: {}, usage: {} };
    };
    await drive(api, executor, () => api.complete.mock.calls.length > 0);
    expect(clicked).toBe(true);
  });

  it("counts a flagged heartbeat the interval timer got acknowledged as the record", async () => {
    const api = fakeApi([agentTask()]);
    let flagged = 0;
    api.taskHeartbeat.mockImplementation((async (_id: string, _lease: number, flag?: boolean) => {
      if (!flag) return { leaseExpiresAt: "2026-10-07T00:10:00.000Z" };
      const call = ++flagged;
      if (call === 1) {
        await new Promise((resolve) => setTimeout(resolve, 60));
        throw new WorkerApiError(503, "unavailable", "down");
      }
      if (call > 2) throw new WorkerApiError(503, "unavailable", "down");
      return { leaseExpiresAt: "2026-10-07T00:10:00.000Z" };
    }) as never);
    let clicked = false;
    const executor: AgentExecutor = async (_task, _signal, progress) => {
      await progress?.mayHaveSubmitted();
      clicked = true;
      return { kind: "complete", result: {}, usage: {} };
    };
    await drive(api, executor, () => api.complete.mock.calls.length > 0);
    expect(clicked).toBe(true);
  });

  it("lets the click through when an interval heartbeat records the flag while a non-transient failure was pending", async () => {
    const api = fakeApi([agentTask()]);
    let flagged = 0;
    api.taskHeartbeat.mockImplementation((async (_id: string, _lease: number, flag?: boolean) => {
      if (!flag) return { leaseExpiresAt: "2026-10-07T00:10:00.000Z" };
      if (++flagged === 1) {
        await new Promise((resolve) => setTimeout(resolve, 80));
        throw new WorkerApiError(400, "bad_request", "no");
      }
      return { leaseExpiresAt: "2026-10-07T00:10:00.000Z" };
    }) as never);
    let clicked = false;
    const executor: AgentExecutor = async (_task, _signal, progress) => {
      try {
        await progress?.mayHaveSubmitted();
        clicked = true;
      } catch {
        clicked = false;
      }
      return { kind: "complete", result: {}, usage: {} };
    };
    await drive(api, executor, () => api.complete.mock.calls.length > 0);
    expect(clicked).toBe(true);
  });

  it("tells the browser which profiles still exist while idle, and never deletes on a silent server", async () => {
    const keepProfiles = vi.fn(async () => undefined);
    const withList = fakeApi([null, null]);
    withList.heartbeat.mockImplementation(async () => ({
      ok: true as const,
      serverTime: "2026-10-07T00:00:00.000Z",
      profileIds: ["p1"],
    }));
    const controller = new AbortController();
    const finished = runLoop({
      api: withList,
      executor: async () => ({ kind: "release", reason: "x" }),
      signal: controller.signal,
      logger: silentLogger,
      workerId: "test-agent",
      pollMs: 5,
      leaseMs: 60_000,
      timing: FAST,
      keepProfiles,
    });
    await vi.waitUntil(() => withList.claim.mock.calls.length >= 2, { timeout: 2000, interval: 5 });
    controller.abort();
    await finished;
    expect(keepProfiles).toHaveBeenCalledWith(["p1"]);

    const silent = fakeApi([null, null]);
    const quiet = vi.fn(async () => undefined);
    const other = new AbortController();
    const done = runLoop({
      api: silent,
      executor: async () => ({ kind: "release", reason: "x" }),
      signal: other.signal,
      logger: silentLogger,
      workerId: "test-agent",
      pollMs: 5,
      leaseMs: 60_000,
      timing: FAST,
      keepProfiles: quiet,
    });
    await vi.waitUntil(() => silent.claim.mock.calls.length >= 2, { timeout: 2000, interval: 5 });
    other.abort();
    await done;
    expect(quiet).not.toHaveBeenCalled();
  });
});
