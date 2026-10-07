import type { DbHandle } from "@kickrocks/db";
import { describe, expect, it } from "vitest";
import { createTaskHandlers } from "./task-handlers.js";
import type { Task, TaskEvent } from "./task-types.js";

function event(kind: Task["kind"], name: TaskEvent["name"]): TaskEvent {
  return { name, actor: "worker", task: { id: "t1", kind } as Task };
}

const tx = {} as DbHandle;

describe("createTaskHandlers", () => {
  it("runs handlers for the matching kind and event only", () => {
    const handlers = createTaskHandlers();
    const seen: string[] = [];
    handlers.on("form", "completed", () => void seen.push("form completed"));
    handlers.on("form", "blocked", () => void seen.push("form blocked"));
    handlers.on("scan", "completed", () => void seen.push("scan completed"));
    handlers.emit(event("form", "completed"), tx);
    expect(seen).toEqual(["form completed"]);
  });

  it("registers one handler for several kinds and several events", () => {
    const handlers = createTaskHandlers();
    const seen: string[] = [];
    handlers.on(["form", "agent"], ["failed", "cancelled"], ({ task, name }) => {
      seen.push(`${task.kind} ${name}`);
    });
    handlers.emit(event("form", "failed"), tx);
    handlers.emit(event("agent", "cancelled"), tx);
    handlers.emit(event("scan", "failed"), tx);
    handlers.emit(event("form", "completed"), tx);
    expect(seen).toEqual(["form failed", "agent cancelled"]);
  });

  it("hands every handler the transaction of the change", () => {
    const handlers = createTaskHandlers();
    let received: DbHandle | undefined;
    handlers.on("form", "completed", (_event, handle) => {
      received = handle;
    });
    handlers.emit(event("form", "completed"), tx);
    expect(received).toBe(tx);
  });

  it("runs handlers in registration order", () => {
    const handlers = createTaskHandlers();
    const order: string[] = [];
    handlers.on("form", "completed", () => void order.push("first"));
    handlers.on("form", "completed", () => void order.push("second"));
    handlers.emit(event("form", "completed"), tx);
    expect(order).toEqual(["first", "second"]);
  });

  it("lets a throw escape, so the change it belongs to rolls back, and stops the handlers after it", () => {
    const handlers = createTaskHandlers();
    const seen: string[] = [];
    handlers.on("form", "completed", () => {
      throw new Error("boom");
    });
    handlers.on("form", "completed", () => void seen.push("never"));
    expect(() => handlers.emit(event("form", "completed"), tx)).toThrow("boom");
    expect(seen).toEqual([]);
  });

  it("rejects a handler that returns a promise, since it would run outside the transaction", () => {
    const handlers = createTaskHandlers();
    handlers.on("form", "completed", (async () => {}) as never);
    expect(() => handlers.emit(event("form", "completed"), tx)).toThrow(/must be synchronous/);
  });

  it("does nothing when no handler is registered", () => {
    expect(() => createTaskHandlers().emit(event("scan", "blocked"), tx)).not.toThrow();
  });
});
