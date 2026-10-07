import { describe, expect, it, vi } from "vitest";
import { createLogger } from "./logger.js";
import { createTaskHandlers } from "./task-handlers.js";
import type { Task, TaskEvent } from "./task-types.js";

function event(kind: Task["kind"], name: TaskEvent["name"]): TaskEvent {
  return { name, actor: "worker", task: { id: "t1", kind } as Task };
}

const logger = createLogger({ logLevel: "silent" });

describe("createTaskHandlers", () => {
  it("runs handlers for the matching kind and event only", async () => {
    const handlers = createTaskHandlers(logger);
    const seen: string[] = [];
    handlers.on("form", "completed", () => void seen.push("form completed"));
    handlers.on("form", "blocked", () => void seen.push("form blocked"));
    handlers.on("scan", "completed", () => void seen.push("scan completed"));
    await handlers.emit(event("form", "completed"));
    expect(seen).toEqual(["form completed"]);
  });

  it("registers one handler for several kinds", async () => {
    const handlers = createTaskHandlers(logger);
    const seen: string[] = [];
    handlers.on(["form", "agent"], "failed", ({ task }) => void seen.push(task.kind));
    await handlers.emit(event("form", "failed"));
    await handlers.emit(event("agent", "failed"));
    await handlers.emit(event("scan", "failed"));
    expect(seen).toEqual(["form", "agent"]);
  });

  it("runs handlers in registration order and waits for async ones", async () => {
    const handlers = createTaskHandlers(logger);
    const order: string[] = [];
    handlers.on("form", "completed", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("slow first");
    });
    handlers.on("form", "completed", () => void order.push("second"));
    await handlers.emit(event("form", "completed"));
    expect(order).toEqual(["slow first", "second"]);
  });

  it("logs a throwing handler and still runs the rest", async () => {
    const error = vi.fn();
    const handlers = createTaskHandlers({ ...logger, error } as never);
    const seen: string[] = [];
    handlers.on("form", "completed", () => {
      throw new Error("boom");
    });
    handlers.on("form", "completed", async () => {
      throw new Error("async boom");
    });
    handlers.on("form", "completed", () => void seen.push("third"));
    await expect(handlers.emit(event("form", "completed"))).resolves.toBeUndefined();
    expect(seen).toEqual(["third"]);
    expect(error).toHaveBeenCalledTimes(2);
    expect(error.mock.calls[0]?.[0]).toMatchObject({
      taskId: "t1",
      kind: "form",
      event: "completed",
    });
  });

  it("does nothing when no handler is registered", async () => {
    await expect(
      createTaskHandlers(logger).emit(event("scan", "blocked")),
    ).resolves.toBeUndefined();
  });
});
