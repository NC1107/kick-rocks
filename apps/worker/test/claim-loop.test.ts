import { type ClaimedTask, WORKER_DEFAULT_KINDS } from "@kickrocks/shared";
import { describe, expect, it, vi } from "vitest";
import { WorkerApiError } from "../src/api-client.js";
import { type ClaimLoopContext, runClaimLoop, type WorkerApi } from "../src/claim-loop.js";
import { SubmitNotRecorded, type TaskReport } from "../src/executor.js";
import { config, silentLogger, summary, task } from "./support.js";

const formTask = () =>
  task("form", { requestId: "r1", targetId: "fixture", recipeId: null, recordUrl: null });

function fakeClient(queue: (ClaimedTask | null)[] = []) {
  const calls: string[] = [];
  const client = {
    heartbeat: vi.fn<WorkerApi["heartbeat"]>(async () => ({
      ok: true as const,
      serverTime: "2026-10-07T00:00:00.000Z",
    })),
    claim: vi.fn(async () => queue.shift() ?? null),
    taskHeartbeat: vi.fn(async () => ({ leaseExpiresAt: "2026-10-07T00:05:00.000Z" })),
    complete: vi.fn(async (id: string) => summary(id)),
    block: vi.fn(async (id: string) => summary(id)),
    fail: vi.fn(async (id: string) => summary(id)),
    release: vi.fn(async (id: string) => summary(id)),
  };
  return { client: client satisfies WorkerApi, calls };
}

interface Setup {
  controller: AbortController;
  context: (overrides?: Partial<ClaimLoopContext>) => ClaimLoopContext;
}

function setup(): Setup {
  const controller = new AbortController();
  return {
    controller,
    context: (overrides = {}) => ({
      config: config(),
      client: fakeClient().client,
      signal: controller.signal,
      executor: async () => ({ kind: "complete", result: {}, usage: {} }),
      logger: silentLogger,
      timing: {
        leaseHeartbeatMs: 15,
        idleHeartbeatMs: 10_000,
        shutdownGraceMs: 80,
        maxBackoffMs: 20,
        reportAttempts: 3,
        reportRetryMs: 2,
      },
      ...overrides,
    }),
  };
}

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Stops the loop once `done` holds, which a test of an endless loop needs. */
async function until(done: () => boolean, controller: AbortController): Promise<void> {
  for (let i = 0; i < 400 && !done(); i++) await delay(10);
  controller.abort();
}

describe("the claim loop", () => {
  it("claims the browser kinds with the configured lease, runs the task, and completes it", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient([formTask()]);
    const executor = vi.fn(
      async (): Promise<TaskReport> => ({
        kind: "complete",
        result: { outcome: "submitted" },
        usage: { durationMs: 12 },
      }),
    );
    const running = runClaimLoop(context({ client, executor }));
    await until(() => client.complete.mock.calls.length > 0, controller);
    await running;
    expect(client.claim).toHaveBeenCalledWith(WORKER_DEFAULT_KINDS, 60_000);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(client.complete).toHaveBeenCalledWith(
      expect.stringMatching(/^task-/),
      { outcome: "submitted" },
      { durationMs: 12 },
    );
  });

  it("works one task at a time, in order", async () => {
    const { controller, context } = setup();
    const first = formTask();
    const second = formTask();
    const { client } = fakeClient([first, second]);
    let running = 0;
    let overlap = false;
    const order: string[] = [];
    const executor = async (claimed: ClaimedTask): Promise<TaskReport> => {
      running += 1;
      overlap ||= running > 1;
      order.push(claimed.id);
      await delay(30);
      running -= 1;
      return { kind: "complete", result: {}, usage: {} };
    };
    const loop = runClaimLoop(context({ client, executor }));
    await until(() => client.complete.mock.calls.length === 2, controller);
    await loop;
    expect(overlap).toBe(false);
    expect(order).toEqual([first.id, second.id]);
  });

  it("keeps polling while there is nothing to claim", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient();
    const loop = runClaimLoop(context({ client }));
    await until(() => client.claim.mock.calls.length >= 3, controller);
    await loop;
    expect(client.claim.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(client.complete).not.toHaveBeenCalled();
  });

  it("backs off and carries on when a claim fails", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient([formTask()]);
    client.claim
      .mockRejectedValueOnce(new WorkerApiError(503, "worker_api_disabled", "off"))
      .mockRejectedValueOnce(new TypeError("fetch failed"));
    const loop = runClaimLoop(context({ client }));
    await until(() => client.complete.mock.calls.length > 0, controller);
    await loop;
    expect(client.claim.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(client.complete).toHaveBeenCalledTimes(1);
  });

  it("tells the server it is busy with the task, then idle again", async () => {
    const { controller, context } = setup();
    const claimed = formTask();
    const { client } = fakeClient([claimed]);
    const loop = runClaimLoop(context({ client, version: "1.2.3" }));
    await until(() => client.complete.mock.calls.length > 0, controller);
    await loop;
    expect(client.heartbeat).toHaveBeenCalledWith({
      busy: true,
      currentTaskId: claimed.id,
      version: "1.2.3",
    });
    await vi.waitFor(() =>
      expect(client.heartbeat).toHaveBeenLastCalledWith({
        busy: false,
        currentTaskId: null,
        version: "1.2.3",
      }),
    );
  });

  it("keeps the lease alive while a task runs", async () => {
    const { controller, context } = setup();
    const claimed = formTask();
    const { client } = fakeClient([claimed]);
    const executor = async (): Promise<TaskReport> => {
      await delay(120);
      return { kind: "complete", result: {}, usage: {} };
    };
    const loop = runClaimLoop(context({ client, executor }));
    await until(() => client.complete.mock.calls.length > 0, controller);
    await loop;
    expect(client.taskHeartbeat.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(client.taskHeartbeat).toHaveBeenCalledWith(claimed.id, 60_000);
  });

  it("stops the run and reports nothing when the task went to another worker", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient([formTask()]);
    client.taskHeartbeat.mockRejectedValue(
      new WorkerApiError(409, "lease_not_held", "Another worker holds this task"),
    );
    let stopped = false;
    const executor = async (_task: ClaimedTask, signal: AbortSignal): Promise<TaskReport> => {
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
      stopped = true;
      return { kind: "release", reason: "aborted" };
    };
    const loop = runClaimLoop(context({ client, executor }));
    await until(() => stopped, controller);
    await loop;
    expect(client.complete).not.toHaveBeenCalled();
    expect(client.release).not.toHaveBeenCalled();
  });

  it("finishes the run and reports it when only the lease ran out, without running the task again", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient([formTask()]);
    client.taskHeartbeat.mockRejectedValue(
      new WorkerApiError(409, "lease_expired", "The lease ran out"),
    );
    let aborted = false;
    const executor = vi.fn(async (_task: ClaimedTask, signal: AbortSignal): Promise<TaskReport> => {
      signal.addEventListener("abort", () => {
        aborted = true;
      });
      await delay(80);
      return { kind: "complete", result: { outcome: "submitted" }, usage: {} };
    });
    const loop = runClaimLoop(context({ client, executor }));
    await until(() => client.complete.mock.calls.length > 0, controller);
    await loop;
    expect(aborted).toBe(false);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(client.complete).toHaveBeenCalledWith(
      expect.stringMatching(/^task-/),
      { outcome: "submitted" },
      {},
    );
  });

  it("keeps running through a heartbeat that fails for another reason", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient([formTask()]);
    client.taskHeartbeat.mockRejectedValue(new TypeError("fetch failed"));
    const executor = async (): Promise<TaskReport> => {
      await delay(60);
      return { kind: "complete", result: { ok: true }, usage: {} };
    };
    const loop = runClaimLoop(context({ client, executor }));
    await until(() => client.complete.mock.calls.length > 0, controller);
    await loop;
    expect(client.complete).toHaveBeenCalledTimes(1);
  });

  it("hands the task back, asking the run to stop, when the worker shuts down mid-task", async () => {
    const { controller, context } = setup();
    const claimed = formTask();
    const { client } = fakeClient([claimed]);
    const executor = async (_task: ClaimedTask, signal: AbortSignal): Promise<TaskReport> => {
      setTimeout(() => controller.abort(), 20);
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
      return { kind: "release", reason: "the worker is shutting down" };
    };
    await runClaimLoop(context({ client, executor }));
    expect(client.release).toHaveBeenCalledWith(claimed.id, undefined);
    expect(client.complete).not.toHaveBeenCalled();
  });

  it("closes the browser and hands the task back when a run ignores the shutdown", async () => {
    const { controller, context } = setup();
    const claimed = formTask();
    const { client } = fakeClient([claimed]);
    let unstick: () => void = () => undefined;
    const stuck = new Promise<void>((resolve) => {
      unstick = resolve;
    });
    const forceStop = vi.fn(async () => unstick());
    const executor = async (): Promise<TaskReport> => {
      setTimeout(() => controller.abort(), 10);
      await stuck;
      return { kind: "fail", report: { error: "browser closed", retryable: true } };
    };
    await runClaimLoop(context({ client, executor, forceStop }));
    expect(forceStop).toHaveBeenCalledTimes(1);
    expect(client.release).toHaveBeenCalledWith(claimed.id, undefined);
    expect(client.complete).not.toHaveBeenCalled();
  });

  it("exits at once when idle and told to stop", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient();
    const loop = runClaimLoop(context({ client, config: config({ pollMs: 60_000 }) }));
    await delay(30);
    const started = Date.now();
    controller.abort();
    await loop;
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("turns an executor that throws into a retryable internal failure", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient([formTask()]);
    const executor = async (): Promise<TaskReport> => {
      throw new Error("boom\nstack");
    };
    const loop = runClaimLoop(context({ client, executor }));
    await until(() => client.fail.mock.calls.length > 0, controller);
    await loop;
    expect(client.fail).toHaveBeenCalledWith(expect.any(String), {
      error: "boom",
      retryable: true,
      kind: "internal",
    });
  });

  describe("reporting", () => {
    async function report(
      kind: TaskReport,
      mutate: (client: ReturnType<typeof fakeClient>["client"]) => void = () => undefined,
    ) {
      const { controller, context } = setup();
      const { client } = fakeClient([formTask()]);
      mutate(client);
      const loop = runClaimLoop(context({ client, executor: async () => kind }));
      await until(
        () =>
          [client.complete, client.block, client.fail, client.release].some(
            (call) => call.mock.calls.length > 0,
          ),
        controller,
      );
      await delay(60);
      await loop;
      return client;
    }

    it("sends a block with its evidence", async () => {
      const client = await report({
        kind: "block",
        report: {
          reason: "captcha",
          detail: "reCAPTCHA",
          url: "https://broker.test/form",
          screenshot: { mime: "image/png", dataBase64: "iVBORw0KGgo=" },
        },
      });
      expect(client.block).toHaveBeenCalledWith(expect.any(String), {
        reason: "captcha",
        detail: "reCAPTCHA",
        url: "https://broker.test/form",
        screenshot: { mime: "image/png", dataBase64: "iVBORw0KGgo=" },
      });
    });

    it("sends a failure with its kind and step", async () => {
      const client = await report({
        kind: "fail",
        report: { error: "gone", retryable: false, kind: "recipe", step: 2 },
      });
      expect(client.fail).toHaveBeenCalledWith(expect.any(String), {
        error: "gone",
        retryable: false,
        kind: "recipe",
        step: 2,
      });
    });

    it("sends a release with the delay the executor asked for", async () => {
      const client = await report({ kind: "release", reason: "no browser", retryAfterMs: 60_000 });
      expect(client.release).toHaveBeenCalledWith(expect.any(String), 60_000);
    });

    it("tries a report again when the server fails, then gives up after a few tries", async () => {
      const flaky = await report({ kind: "complete", result: {}, usage: {} }, (client) => {
        client.complete
          .mockRejectedValueOnce(new WorkerApiError(503, "unavailable", "down"))
          .mockRejectedValueOnce(new TypeError("fetch failed"));
      });
      expect(flaky.complete).toHaveBeenCalledTimes(3);

      const down = await report({ kind: "complete", result: {}, usage: {} }, (client) => {
        client.complete.mockRejectedValue(new TypeError("fetch failed"));
      });
      expect(down.complete).toHaveBeenCalledTimes(3);
    });

    it("does not try again when the server refuses the report", async () => {
      const client = await report({ kind: "block", report: { reason: "captcha" } }, (c) =>
        c.block.mockRejectedValue(new WorkerApiError(404, "task_not_found", "gone")),
      );
      expect(client.block).toHaveBeenCalledTimes(1);
    });

    it("does not try again when the task is no longer ours", async () => {
      const client = await report({ kind: "complete", result: {}, usage: {} }, (c) =>
        c.complete.mockRejectedValue(new WorkerApiError(409, "lease_not_held", "no")),
      );
      expect(client.complete).toHaveBeenCalledTimes(1);
      expect(client.fail).not.toHaveBeenCalled();
    });

    it("reports a result the server rejects as a failure, which it cannot retry", async () => {
      const client = await report(
        { kind: "complete", result: { odd: true }, usage: { durationMs: 5 } },
        (c) =>
          c.complete.mockRejectedValue(new WorkerApiError(400, "invalid_request", "bad result")),
      );
      expect(client.fail).toHaveBeenCalledWith(expect.any(String), {
        error: "The server rejected the result: bad result",
        retryable: false,
        kind: "internal",
        usage: { durationMs: 5 },
      });
    });
  });
});

describe("a removal that may have been submitted", () => {
  it("tells the server before the run goes on, and with every later lease heartbeat", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient([formTask()]);
    const executor = async (
      _task: ClaimedTask,
      _signal: AbortSignal,
      progress?: { mayHaveSubmitted(): Promise<void> },
    ): Promise<TaskReport> => {
      expect(client.taskHeartbeat).not.toHaveBeenCalledWith(expect.any(String), 60_000, true);
      await progress?.mayHaveSubmitted();
      expect(client.taskHeartbeat).toHaveBeenCalledWith(expect.any(String), 60_000, true);
      const before = client.taskHeartbeat.mock.calls.length;
      await delay(60);
      expect(client.taskHeartbeat.mock.calls.length).toBeGreaterThan(before);
      for (const call of client.taskHeartbeat.mock.calls.slice(before)) {
        expect(call).toEqual([expect.any(String), 60_000, true]);
      }
      return { kind: "complete", result: {}, usage: {} };
    };
    const running = runClaimLoop(context({ client, executor }));
    await until(() => client.complete.mock.calls.length > 0, controller);
    await running;
    expect(client.complete).toHaveBeenCalled();
  });

  it("sends the flag once, however often the run reports it", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient([formTask()]);
    const executor = async (
      _task: ClaimedTask,
      _signal: AbortSignal,
      progress?: { mayHaveSubmitted(): Promise<void> },
    ): Promise<TaskReport> => {
      await progress?.mayHaveSubmitted();
      await progress?.mayHaveSubmitted();
      const calls = client.taskHeartbeat.mock.calls as unknown[][];
      const flagged = calls.filter((call) => call[2] === true);
      expect(flagged).toHaveLength(1);
      return { kind: "complete", result: {}, usage: {} };
    };
    const running = runClaimLoop(context({ client, executor }));
    await until(() => client.complete.mock.calls.length > 0, controller);
    await running;
  });

  it("lets the click through when an interval heartbeat records the flag while a non-transient failure was pending", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient([formTask()]);
    let flagged = 0;
    client.taskHeartbeat.mockImplementation((async (_id: string, _lease: number, flag?: boolean) => {
      if (!flag) return { leaseExpiresAt: "2026-10-07T00:05:00.000Z" };
      if (++flagged === 1) {
        await delay(80);
        throw new WorkerApiError(400, "bad_request", "no");
      }
      return { leaseExpiresAt: "2026-10-07T00:05:00.000Z" };
    }) as never);
    let clicked = false;
    const executor = async (
      _task: ClaimedTask,
      _signal: AbortSignal,
      progress?: { mayHaveSubmitted(): Promise<void> },
    ): Promise<TaskReport> => {
      try {
        await progress?.mayHaveSubmitted();
        clicked = true;
      } catch {
        clicked = false;
      }
      return { kind: "complete", result: {}, usage: {} };
    };
    const running = runClaimLoop(context({ client, executor }));
    await until(() => client.complete.mock.calls.length > 0, controller);
    await running;
    expect(clicked).toBe(true);
  });

  describe.each([
    ["a 503", () => new WorkerApiError(503, "unavailable", "down")],
    ["a network error", () => new TypeError("fetch failed")],
    ["a lease that is no longer ours", () => new WorkerApiError(409, "lease_not_held", "taken")],
    ["a lease that lapsed", () => new WorkerApiError(409, "lease_expired", "lapsed")],
  ])("when the flagged heartbeat meets %s", (_name, makeError) => {
    it("does not let the run click", async () => {
      const { controller, context } = setup();
      const { client } = fakeClient([formTask()]);
      client.taskHeartbeat.mockImplementation((async (
        _id: string,
        _lease: number,
        flag?: boolean,
      ) => {
        if (flag) throw makeError();
        return { leaseExpiresAt: "2026-10-07T00:05:00.000Z" };
      }) as never);
      let clicked = false;
      let refusal: unknown;
      let ran = false;
      const executor = async (
        _task: ClaimedTask,
        _signal: AbortSignal,
        progress?: { mayHaveSubmitted(): Promise<void> },
      ): Promise<TaskReport> => {
        try {
          await progress?.mayHaveSubmitted();
          clicked = true;
        } catch (error) {
          refusal = error;
        }
        ran = true;
        return { kind: "release", reason: "not recorded" };
      };
      const running = runClaimLoop(context({ client, executor }));
      await until(() => ran, controller);
      await running;
      expect(clicked).toBe(false);
      expect(refusal).toBeInstanceOf(SubmitNotRecorded);
    });
  });

  it("retries a flagged heartbeat that failed in passing, and lets the click through once it is acknowledged", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient([formTask()]);
    let failures = 1;
    client.taskHeartbeat.mockImplementation((async (
      _id: string,
      _lease: number,
      flag?: boolean,
    ) => {
      if (flag && failures-- > 0) throw new WorkerApiError(503, "unavailable", "down");
      return { leaseExpiresAt: "2026-10-07T00:05:00.000Z" };
    }) as never);
    let clicked = false;
    const executor = async (
      _task: ClaimedTask,
      _signal: AbortSignal,
      progress?: { mayHaveSubmitted(): Promise<void> },
    ): Promise<TaskReport> => {
      await progress?.mayHaveSubmitted();
      clicked = true;
      return { kind: "complete", result: {}, usage: {} };
    };
    const running = runClaimLoop(context({ client, executor }));
    await until(() => client.complete.mock.calls.length > 0, controller);
    await running;
    expect(clicked).toBe(true);
  });

  it("counts a flagged heartbeat the interval timer got acknowledged as the record", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient([formTask()]);
    let flagged = 0;
    client.taskHeartbeat.mockImplementation((async (
      _id: string,
      _lease: number,
      flag?: boolean,
    ) => {
      if (!flag) return { leaseExpiresAt: "2026-10-07T00:05:00.000Z" };
      const call = ++flagged;
      if (call === 1) {
        await delay(50);
        throw new WorkerApiError(503, "unavailable", "down");
      }
      if (call > 2) throw new WorkerApiError(503, "unavailable", "down");
      return { leaseExpiresAt: "2026-10-07T00:05:00.000Z" };
    }) as never);
    let clicked = false;
    const executor = async (
      _task: ClaimedTask,
      _signal: AbortSignal,
      progress?: { mayHaveSubmitted(): Promise<void> },
    ): Promise<TaskReport> => {
      await progress?.mayHaveSubmitted();
      clicked = true;
      return { kind: "complete", result: {}, usage: {} };
    };
    const running = runClaimLoop(context({ client, executor }));
    await until(() => client.complete.mock.calls.length > 0, controller);
    await running;
    expect(clicked).toBe(true);
  });

  it("keeps a result that finishes after the browser was closed under the run", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient([formTask()]);
    let unblock: () => void = () => undefined;
    const executor = (): Promise<TaskReport> =>
      new Promise((resolve) => {
        controller.abort();
        unblock = () => resolve({ kind: "complete", result: { outcome: "submitted" }, usage: {} });
      });
    const running = runClaimLoop(context({ client, executor, forceStop: async () => unblock() }));
    await running;
    expect(client.complete).toHaveBeenCalled();
    expect(client.release).not.toHaveBeenCalled();
  });
});

describe("forgetting deleted profiles", () => {
  const answer = (profileIds?: string[]) => ({
    ok: true as const,
    serverTime: "2026-10-07T00:00:00.000Z",
    ...(profileIds ? { profileIds } : {}),
  });

  it("passes the server's list on while idle, and not while a task is running", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient([formTask()]);
    let busy = false;
    client.heartbeat.mockImplementation(async (status: { busy: boolean }) => {
      busy = status.busy;
      return answer(["p1", "p2"]);
    });
    const busyWhenCalled: boolean[] = [];
    const keepProfiles = vi.fn(async () => void busyWhenCalled.push(busy));
    const executor = async (): Promise<TaskReport> => {
      await delay(60);
      return { kind: "complete", result: {}, usage: {} };
    };
    const running = runClaimLoop(context({ client, executor, keepProfiles }));
    await until(() => client.complete.mock.calls.length > 0, controller);
    await running;
    expect(keepProfiles).toHaveBeenCalledWith(["p1", "p2"]);
    expect(busyWhenCalled.length).toBeGreaterThan(0);
    expect(busyWhenCalled).not.toContain(true);
  });

  it("deletes nothing when the server does not say which profiles exist", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient();
    client.heartbeat.mockImplementation(async () => answer());
    const keepProfiles = vi.fn(async () => undefined);
    const running = runClaimLoop(context({ client, keepProfiles }));
    await until(() => client.claim.mock.calls.length >= 2, controller);
    await running;
    expect(keepProfiles).not.toHaveBeenCalled();
  });

  it("carries on when removing the data fails", async () => {
    const { controller, context } = setup();
    const { client } = fakeClient([formTask()]);
    client.heartbeat.mockImplementation(async () => answer([]));
    const keepProfiles = vi.fn(async () => {
      throw new Error("EBUSY");
    });
    const running = runClaimLoop(context({ client, keepProfiles }));
    await until(() => client.complete.mock.calls.length > 0, controller);
    await running;
    expect(client.complete).toHaveBeenCalled();
  });
});
