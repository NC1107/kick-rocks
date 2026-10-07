import type { DbHandle } from "@kickrocks/db";
import type { TaskKind } from "@kickrocks/shared";
import type { TaskEvent, TaskEventName } from "./task-types.js";

/**
 * Handlers are synchronous and run inside the transaction that changed the task. Anything they
 * write through `tx`, or through a core service (which joins the same transaction), commits or
 * rolls back together with the task change. They must not await: a handler that returns a promise
 * is a bug and is reported as one.
 */
export type TaskHandler<K extends TaskKind = TaskKind> = (
  event: TaskEvent<K>,
  tx: DbHandle,
) => void;

/**
 * Lets feature modules react to a task changing state without the queue knowing about them.
 *
 * Why in the transaction: a handler is where the consequence of a task lives (scan candidates
 * become matches, a form result advances its request, a recipe failure falls back to an agent).
 * Run after the commit, a crash or a throw between the two would lose that consequence for good
 * and nothing would show it was missing. Run inside it, the task change and its consequences are
 * one unit: if a handler throws, the change is rolled back and the caller sees the error, so a
 * worker that gets a 500 from `complete` still holds its lease and can report again.
 *
 * So a handler must tolerate a world that has moved on (a request the person has since
 * cancelled, a task whose target is retired) by doing nothing, not by throwing. It throws only for
 * a bug, which is rare enough that failing the whole change loudly is the right answer.
 *
 * Handlers run in the order they were registered. Work that cannot be undone, such as sending
 * mail or telling a person, must be queued as a task from a handler and done by a runner.
 */
export interface TaskHandlers {
  on<K extends TaskKind>(
    kinds: K | readonly K[],
    name: TaskEventName | readonly TaskEventName[],
    handler: TaskHandler<K>,
  ): void;
  /** Runs every handler for the event, in the caller's transaction. */
  emit(event: TaskEvent, tx: DbHandle): void;
}

export function createTaskHandlers(): TaskHandlers {
  const registry = new Map<string, TaskHandler<never>[]>();
  const keyOf = (kind: TaskKind, name: TaskEventName) => `${kind}:${name}`;

  return {
    on(kinds, names, handler) {
      const kindList = typeof kinds === "string" ? [kinds] : kinds;
      const nameList = typeof names === "string" ? [names] : names;
      for (const kind of kindList) {
        for (const name of nameList) {
          const key = keyOf(kind, name);
          registry.set(key, [...(registry.get(key) ?? []), handler as TaskHandler<never>]);
        }
      }
    },

    emit(event, tx) {
      for (const handler of registry.get(keyOf(event.task.kind, event.name)) ?? []) {
        const returned: unknown = (handler as TaskHandler)(event, tx);
        if (returned instanceof Promise) {
          throw new TypeError(
            `A task handler for ${event.task.kind}:${event.name} returned a promise; handlers run inside a transaction and must be synchronous`,
          );
        }
      }
    },
  };
}
