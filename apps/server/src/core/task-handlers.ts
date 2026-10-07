import type { TaskKind } from "@kickrocks/shared";
import type { Logger } from "./logger.js";
import type { TaskEvent, TaskEventName } from "./task-types.js";

export type TaskHandler<K extends TaskKind = TaskKind> = (
  event: TaskEvent<K>,
) => void | Promise<void>;

/**
 * Lets feature modules react to a task changing state without the queue knowing about them.
 * Handlers run after the state change has committed, in the order they were registered, and a
 * handler that throws is logged without affecting the task or the handlers after it.
 */
export interface TaskHandlers {
  /** `failed` fires only for a terminal failure; a failure that will be retried is not an event. */
  on<K extends TaskKind>(
    kinds: K | readonly K[],
    name: TaskEventName,
    handler: TaskHandler<K>,
  ): void;
  emit(event: TaskEvent): Promise<void>;
}

export function createTaskHandlers(logger: Logger): TaskHandlers {
  const registry = new Map<string, TaskHandler<never>[]>();
  const keyOf = (kind: TaskKind, name: TaskEventName) => `${kind}:${name}`;

  return {
    on(kinds, name, handler) {
      for (const kind of typeof kinds === "string" ? [kinds] : kinds) {
        const key = keyOf(kind, name);
        registry.set(key, [...(registry.get(key) ?? []), handler as TaskHandler<never>]);
      }
    },

    async emit(event) {
      for (const handler of registry.get(keyOf(event.task.kind, event.name)) ?? []) {
        try {
          await (handler as TaskHandler)(event);
        } catch (error) {
          logger.error(
            { err: error, taskId: event.task.id, kind: event.task.kind, event: event.name },
            "task handler failed",
          );
        }
      }
    },
  };
}
