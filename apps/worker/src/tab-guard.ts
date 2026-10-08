import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

const ENDPOINT_FILE = "DevToolsActivePort";
const ENDPOINT_WAIT_MS = 10_000;

interface Pending {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
}

interface AttachedEvent {
  sessionId: string;
  targetInfo: { type: string; targetId?: string };
  waitingForDebugger: boolean;
}

interface PausedRequest {
  requestId: string;
  request: { headers: Record<string, string> };
}

interface Registration {
  scopeURL: string;
}

interface Message {
  id?: number;
  method?: string;
  sessionId?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string };
}

/** What Chrome calls the target of a tab, and of a frame that runs in a process of its own. */
const GUARDED_TARGETS = [{ type: "page" }, { type: "iframe" }, { exclude: true }];
const GUARDED_TARGETS_WITH_SHARED_WORKERS = [{ type: "shared_worker" }, ...GUARDED_TARGETS];

/** Chrome marks the request for a worker's script, which is how a worker is kept from installing. */
function isServiceWorkerScript(paused: PausedRequest): boolean {
  return Object.entries(paused.request.headers).some(
    ([name, value]) => name.toLowerCase() === "service-worker" && value === "script",
  );
}

/** Chrome writes its debugging address into the profile, so a stale one must go before a launch. */
export function forgetDevToolsEndpoint(profileDir: string): void {
  rmSync(join(profileDir, ENDPOINT_FILE), { force: true });
}

async function readEndpoint(profileDir: string): Promise<string> {
  const deadline = Date.now() + ENDPOINT_WAIT_MS;
  for (;;) {
    try {
      const [port, path] = readFileSync(join(profileDir, ENDPOINT_FILE), "utf8").split("\n");
      if (port && path) return `ws://127.0.0.1:${port}${path}`;
    } catch {
      // Chrome has not written it yet.
    }
    if (Date.now() > deadline) throw new Error("Chrome did not report its debugging address");
    await sleep(25);
  }
}

/**
 * A second, flat DevTools connection to the browser itself. Playwright hands a tab out after it
 * has started, so anything it does to a tab comes too late for the tab's first request, and a
 * service worker answers before request interception sees it. Pausing at the browser level
 * reaches every request of every tab, including a popup's first one, and lets the guard refuse
 * service worker scripts before any worker installs. Playwright cannot address the sessions it
 * did not create, so this speaks the protocol itself.
 */
class FlatConnection {
  private nextId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, (params: unknown) => void>();

  constructor(
    private readonly socket: WebSocket,
    private readonly onAttached: (event: AttachedEvent) => void,
    private readonly onRequest: (event: PausedRequest) => void,
  ) {
    socket.addEventListener("message", (event) =>
      this.receive(JSON.parse(String(event.data)) as Message),
    );
    socket.addEventListener("close", () => {
      for (const waiting of this.pending.values()) waiting.reject(new Error("Chrome went away"));
      this.pending.clear();
    });
  }

  send(method: string, params: object = {}, sessionId?: string): Promise<unknown> {
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
  }

  close(): void {
    this.socket.close();
  }

  /** The next event of one session, or null when none comes within the wait. */
  nextEvent<T>(method: string, sessionId: string, waitMs: number): Promise<T | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.listeners.delete(key);
        resolve(null);
      }, waitMs);
      const key = `${sessionId}:${method}`;
      this.listeners.set(key, (params) => {
        clearTimeout(timer);
        this.listeners.delete(key);
        resolve(params as T);
      });
    });
  }

  private receive(message: Message): void {
    if (message.id !== undefined) {
      const waiting = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) waiting?.reject(new Error(message.error.message));
      else waiting?.resolve(message.result);
      return;
    }
    if (message.method === "Fetch.requestPaused" && message.sessionId === undefined) {
      this.onRequest(message.params as PausedRequest);
      return;
    }
    if (message.method === "Target.attachedToTarget") {
      this.onAttached(message.params as AttachedEvent);
    }
    if (message.method !== undefined && message.sessionId !== undefined) {
      this.listeners.get(`${message.sessionId}:${message.method}`)?.(message.params);
    }
  }
}

export interface TabGuard {
  /** Unregisters every service worker the browser holds, so none outlives the task that met it. */
  clearServiceWorkers(): Promise<void>;
  close(): void;
}

const REGISTRATIONS_WAIT_MS = 500;

export interface TabGuardOptions {
  /** Stalls the guard before it acts on a new tab, so a test can show the result is not a race. */
  holdDelayMs?: number;
  /** Lets service worker scripts load, so a test can have a real worker to clear. */
  allowServiceWorkerScripts?: boolean;
  /** Closes every shared worker the moment it appears, before it runs anything. */
  blockSharedWorkers?: boolean;
}

/**
 * Refuses every service worker script, so no worker installs and nothing depends on how fast a
 * tab is reached. Chrome also pauses tabs that have no opener, and every frame in its own
 * process, until service workers are bypassed for them. A popup that has an opener is not
 * paused, so the refusal is what protects it. Needs Chrome started with a debugging port.
 */
export async function bypassServiceWorkersBeforeTabsRun(
  profileDir: string,
  options: TabGuardOptions = {},
): Promise<TabGuard> {
  const endpoint = await readEndpoint(profileDir);
  const socket = new WebSocket(endpoint);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Could not reach Chrome")), {
      once: true,
    });
  });

  const attach = (session?: string) =>
    connection.send(
      "Target.setAutoAttach",
      {
        autoAttach: true,
        waitForDebuggerOnStart: true,
        flatten: true,
        filter: options.blockSharedWorkers ? GUARDED_TARGETS_WITH_SHARED_WORKERS : GUARDED_TARGETS,
      },
      session,
    );

  const hold = async (event: AttachedEvent): Promise<void> => {
    const { sessionId } = event;
    if (event.targetInfo.type === "shared_worker") {
      // It was held at its start and is never let go.
      if (event.targetInfo.targetId !== undefined) {
        await connection
          .send("Target.closeTarget", { targetId: event.targetInfo.targetId })
          .catch(() => undefined);
      }
      return;
    }
    try {
      if (options.holdDelayMs) await sleep(options.holdDelayMs);
      await connection.send("Network.enable", {}, sessionId);
      await connection.send("Network.setBypassServiceWorker", { bypass: true }, sessionId);
      await attach(sessionId);
    } catch {
      return;
    }
    if (event.waitingForDebugger) {
      await connection
        .send("Runtime.runIfWaitingForDebugger", {}, sessionId)
        .catch(() => undefined);
    }
  };

  const connection: FlatConnection = new FlatConnection(
    socket,
    (event) => {
      hold(event).catch(() => undefined);
    },
    (paused) => {
      const refused = !options.allowServiceWorkerScripts && isServiceWorkerScript(paused);
      connection
        .send(
          refused ? "Fetch.failRequest" : "Fetch.continueRequest",
          refused
            ? { requestId: paused.requestId, errorReason: "BlockedByClient" }
            : { requestId: paused.requestId },
        )
        .catch(() => undefined);
    },
  );
  await connection.send("Fetch.enable", {
    patterns: [{ urlPattern: "*", requestStage: "Request" }],
  });
  await attach();

  const clearServiceWorkers = async (): Promise<void> => {
    const { targetInfos } = (await connection.send("Target.getTargets")) as {
      targetInfos: { targetId: string; type: string }[];
    };
    const tab = targetInfos.find((target) => target.type === "page");
    if (!tab) return;
    const { sessionId } = (await connection.send("Target.attachToTarget", {
      targetId: tab.targetId,
      flatten: true,
    })) as { sessionId: string };
    try {
      const known = connection.nextEvent<{ registrations: Registration[] }>(
        "ServiceWorker.workerRegistrationUpdated",
        sessionId,
        REGISTRATIONS_WAIT_MS,
      );
      await connection.send("ServiceWorker.enable", {}, sessionId);
      const update = await known;
      for (const { scopeURL } of update?.registrations ?? []) {
        await connection.send("ServiceWorker.unregister", { scopeURL }, sessionId);
      }
      await connection.send("ServiceWorker.disable", {}, sessionId);
    } finally {
      await connection.send("Target.detachFromTarget", { sessionId }).catch(() => undefined);
    }
  };
  return { clearServiceWorkers, close: () => connection.close() };
}
