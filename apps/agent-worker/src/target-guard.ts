/** The part of a DevTools connection the guard needs: commands out, events in. */
export interface CdpChannel {
  send(method: string, params?: object): Promise<unknown>;
  on(event: string, handler: (params: never) => void): void;
}

export interface TargetInfo {
  targetId?: string;
  type: string;
  url?: string;
}

interface AttachedEvent {
  sessionId: string;
  targetInfo: TargetInfo;
  waitingForDebugger: boolean;
}

/**
 * The kinds of target the gate can read the requests of. A frame in a process of its own and a
 * dedicated worker both have a DevTools session that can intercept what they load. Every other
 * kind, a shared worker, a service worker, a prerendered page or one this program has never met,
 * cannot be inspected, so it is never allowed to start.
 */
const GUARDABLE_TARGETS = new Set(["iframe", "worker"]);

export function canGuard(type: string): boolean {
  return GUARDABLE_TARGETS.has(type);
}

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

type Handler = (params: never) => void;

/**
 * A DevTools session that rides on its parent's connection. Playwright does not let a script
 * address the sessions it did not create, so the frames' sessions are reached through the parent
 * with `Target.sendMessageToTarget`, which also works for the sessions nested inside them.
 */
class ChildChannel implements CdpChannel {
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly handlers = new Map<string, Handler[]>();

  constructor(
    private readonly parent: CdpChannel,
    private readonly sessionId: string,
  ) {}

  send(method: string, params: object = {}): Promise<unknown> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.parent
        .send("Target.sendMessageToTarget", {
          sessionId: this.sessionId,
          message: JSON.stringify({ id, method, params }),
        })
        .catch((error: unknown) => {
          this.pending.delete(id);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
    });
  }

  on(event: string, handler: Handler): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
  }

  receive(raw: string): void {
    const message = JSON.parse(raw) as {
      id?: number;
      method?: string;
      params?: unknown;
      result?: unknown;
      error?: { message: string };
    };
    if (message.id !== undefined) {
      const waiting = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) waiting?.reject(new Error(message.error.message));
      else waiting?.resolve(message.result);
      return;
    }
    for (const handler of this.handlers.get(message.method ?? "") ?? []) {
      handler(message.params as never);
    }
  }

  close(): void {
    for (const waiting of this.pending.values()) waiting.reject(new Error("The frame went away"));
    this.pending.clear();
  }
}

/**
 * Runs `guard` on every target that lives outside the page, before the target runs anything: a
 * frame of another site has its own request interception, and so does a worker, so a guard on the
 * page never sees what either loads. Each new target is held at its start, guarded, and only
 * then let go. A target that could not be guarded, or that is of a kind that cannot be, is never
 * let go, because an unguarded target is the hole.
 */
export async function guardTargets(
  parent: CdpChannel,
  guard: (target: CdpChannel, info: TargetInfo) => Promise<void>,
  onFailure: (error: unknown, info?: TargetInfo) => void,
): Promise<void> {
  const children = new Map<string, ChildChannel>();

  parent.on("Target.receivedMessageFromTarget", ((event: {
    sessionId: string;
    message: string;
  }) => {
    children.get(event.sessionId)?.receive(event.message);
  }) as Handler);
  parent.on("Target.detachedFromTarget", ((event: { sessionId: string }) => {
    children.get(event.sessionId)?.close();
    children.delete(event.sessionId);
  }) as Handler);

  const adopt = async (event: AttachedEvent): Promise<void> => {
    const { targetInfo } = event;
    const child = new ChildChannel(parent, event.sessionId);
    children.set(event.sessionId, child);
    if (!canGuard(targetInfo.type)) {
      onFailure(
        new Error(`A ${targetInfo.type || "target of an unknown kind"} cannot be checked`),
        targetInfo,
      );
      if (targetInfo.targetId !== undefined) {
        await parent
          .send("Target.closeTarget", { targetId: targetInfo.targetId })
          .catch(() => undefined);
      }
      return;
    }
    try {
      await guardTargets(child, guard, onFailure);
      await guard(child, targetInfo);
    } catch (error) {
      onFailure(error, targetInfo);
      return;
    }
    if (event.waitingForDebugger) {
      await child.send("Runtime.runIfWaitingForDebugger").catch(() => undefined);
    }
  };
  parent.on("Target.attachedToTarget", ((event: AttachedEvent) => {
    adopt(event).catch((error: unknown) => onFailure(error, event.targetInfo));
  }) as Handler);

  await parent.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: true,
    flatten: false,
  });
}
