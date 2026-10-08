import { describe, expect, it, vi } from "vitest";
import { type CdpChannel, canGuard, guardTargets } from "./target-guard.js";

class FakeParent implements CdpChannel {
  readonly sent: { method: string; params: Record<string, unknown> }[] = [];
  private readonly handlers = new Map<string, ((params: never) => void)[]>();

  async send(method: string, params: object = {}): Promise<unknown> {
    this.sent.push({ method, params: params as Record<string, unknown> });
    if (method === "Target.sendMessageToTarget") {
      // The child answers every command it is sent.
      const { sessionId, message } = params as { sessionId: string; message: string };
      const sentInto = JSON.parse(message) as {
        id: number;
        method: string;
        params?: { sessionId: string; message: string };
      };
      queueMicrotask(() =>
        this.emit("Target.receivedMessageFromTarget", {
          sessionId,
          message: JSON.stringify({ id: sentInto.id, result: {} }),
        }),
      );
      if (sentInto.method === "Target.sendMessageToTarget" && sentInto.params) {
        // A command for a session nested inside the child is answered through the child.
        const inner = JSON.parse(sentInto.params.message) as { id: number };
        queueMicrotask(() =>
          this.emit("Target.receivedMessageFromTarget", {
            sessionId,
            message: JSON.stringify({
              method: "Target.receivedMessageFromTarget",
              params: {
                sessionId: sentInto.params?.sessionId,
                message: JSON.stringify({ id: inner.id, result: {} }),
              },
            }),
          }),
        );
      }
    }
    return {};
  }

  on(event: string, handler: (params: never) => void): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
  }

  emit(event: string, params: unknown): void {
    for (const handler of this.handlers.get(event) ?? []) handler(params as never);
  }

  attach(sessionId: string, type: string, url = "https://x.test/"): void {
    this.emit("Target.attachedToTarget", {
      sessionId,
      targetInfo: { targetId: `target-${sessionId}`, type, url },
      waitingForDebugger: true,
    });
  }

  /** The commands sent into one child session, by method. */
  into(sessionId: string): string[] {
    return this.sent
      .filter((entry) => entry.method === "Target.sendMessageToTarget")
      .filter((entry) => entry.params.sessionId === sessionId)
      .map((entry) => (JSON.parse(String(entry.params.message)) as { method: string }).method);
  }

  closed(): string[] {
    return this.sent
      .filter((entry) => entry.method === "Target.closeTarget")
      .map((entry) => String(entry.params.targetId));
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

describe("which targets the gate can read", () => {
  it("covers a frame in its own process and a dedicated worker, and nothing else", () => {
    expect(canGuard("iframe")).toBe(true);
    expect(canGuard("worker")).toBe(true);
    for (const type of ["shared_worker", "service_worker", "page", "browser", "other", ""]) {
      expect(canGuard(type), type).toBe(false);
    }
  });
});

describe("a target that appears while the page runs", () => {
  it.each(["iframe", "worker"])("is guarded, then let go, when it is a %s", async (type) => {
    const parent = new FakeParent();
    const guard = vi.fn(async () => undefined);
    await guardTargets(parent, guard, () => undefined);

    parent.attach("s1", type);
    await settle();

    expect(guard).toHaveBeenCalledTimes(1);
    expect(parent.into("s1")).toContain("Target.setAutoAttach");
    expect(parent.into("s1").at(-1)).toBe("Runtime.runIfWaitingForDebugger");
  });

  it.each(["shared_worker", "service_worker", "page", "browser", "something_new"])(
    "is never let go, and is closed, when it is a %s",
    async (type) => {
      const parent = new FakeParent();
      const guard = vi.fn(async () => undefined);
      const failures: unknown[] = [];
      await guardTargets(parent, guard, (error) => failures.push(error));

      parent.attach("s1", type);
      await settle();

      expect(guard).not.toHaveBeenCalled();
      expect(parent.into("s1")).toEqual([]);
      expect(parent.closed()).toEqual(["target-s1"]);
      expect(failures).toHaveLength(1);
    },
  );

  it("is never let go when its guard fails", async () => {
    const parent = new FakeParent();
    const failures: unknown[] = [];
    await guardTargets(
      parent,
      async () => {
        throw new Error("could not attach");
      },
      (error) => failures.push(error),
    );

    parent.attach("s1", "iframe");
    await settle();

    expect(parent.into("s1")).not.toContain("Runtime.runIfWaitingForDebugger");
    expect(failures).toHaveLength(1);
  });

  it("is looked for inside a frame too, so a worker made by a frame is guarded", async () => {
    const parent = new FakeParent();
    const guarded: string[] = [];
    await guardTargets(
      parent,
      async (_, info) => {
        guarded.push(info.type);
      },
      () => undefined,
    );
    parent.attach("s1", "iframe");
    await settle();

    // The frame's own session reports a worker of its own.
    parent.emit("Target.receivedMessageFromTarget", {
      sessionId: "s1",
      message: JSON.stringify({
        method: "Target.attachedToTarget",
        params: {
          sessionId: "s2",
          targetInfo: { targetId: "t2", type: "worker", url: "blob:https://x.test/1" },
          waitingForDebugger: true,
        },
      }),
    });
    await settle();

    expect(guarded).toEqual(["iframe", "worker"]);
  });
});
