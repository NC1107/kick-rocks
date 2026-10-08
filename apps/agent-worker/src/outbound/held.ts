import {
  type ApprovedSend,
  matchesApproved,
  type OutgoingRequest,
  type RegisteredSend,
  type SendRegistration,
  type SubmitGate,
  type TaskScreenshot,
  type WorkerDecision,
} from "@kickrocks/shared";
import { WorkerApiError } from "@kickrocks/worker/dist/api-client.js";
import { describeError, type Logger } from "@kickrocks/worker/dist/logger.js";

/** The calls the gate makes on the server, so a test can stand in for it. */
export interface SendsApi {
  registerSends(items: SendRegistration[]): Promise<RegisteredSend[]>;
  awaitDecision(sendId: string, waitMs: number, signal: AbortSignal): Promise<WorkerDecision>;
  /** Rejects with a 409 `WorkerApiError` when the server does not know the request as approved. */
  releaseSend(sendId: string, request: OutgoingRequest): Promise<{ releaseId: string }>;
  sendResult(
    sendId: string,
    outcome: { status: number | null; error?: string | undefined },
  ): Promise<void>;
}

export type SendOutcome =
  | { kind: "release"; releaseId: string; heldId?: string }
  | { kind: "refuse"; note: string }
  | { kind: "lapse"; note: string };

const POLL_MS = 25_000;
const FLUSH_MS = 200;
const FLUSH_AT = 20;
const SETTLE_MS = 15_000;
const HOLD_GRACE_MS = 2_000;

interface DeskOptions {
  api: SendsApi;
  gate: SubmitGate;
  logger: Logger;
  signal: AbortSignal;
  /** The page as it stands, for the person to look at before deciding. */
  capture: () => Promise<TaskScreenshot | undefined>;
  /** Tells the model something about what the gate did, in words that hold none of the person's values. */
  note: (text: string) => void;
  /** Called with the time one hold took, which the run does not count against its budget. */
  onHeld: (ms: number) => void;
  now?: () => number;
}

function mismatch(error: unknown): boolean {
  return error instanceof WorkerApiError && error.status === 409;
}

/** Names a request in a note, with nothing of the person in it. */
export function describeRequest(request: OutgoingRequest): string {
  const destination = `${request.method} ${request.host}${request.path}`;
  return request.party === "third" ? `${destination} (another site)` : destination;
}

/**
 * What the gate does with a request that is a send. It keeps the request held while the server
 * and the person decide, and only ever says "release" after the server has written down that the
 * form may be out. Every failure of that conversation ends in a refusal, never in a release.
 */
export class SendDesk {
  private readonly buffer: SendRegistration[] = [];
  private flushing: Promise<void> = Promise.resolve();
  private flushTimer: NodeJS.Timeout | undefined;
  private readonly spent = new Set<string>();
  private pending = 0;
  private idle: (() => void)[] = [];
  private readonly now: () => number;
  private readonly results = new Set<Promise<void>>();
  private readonly stopper = new AbortController();
  private releasedCount = 0;

  constructor(private readonly options: DeskOptions) {
    this.now = options.now ?? Date.now;
  }

  get mode(): SubmitGate["mode"] {
    return this.options.gate.mode;
  }

  /** Records a decision that does not hold the request, such as a lookup or a refusal. */
  log(item: SendRegistration): void {
    this.buffer.push(item);
    if (this.buffer.length >= FLUSH_AT) {
      this.flush().catch(() => undefined);
      return;
    }
    this.flushTimer ??= setTimeout(() => {
      this.flush().catch(() => undefined);
    }, FLUSH_MS);
  }

  /** Sends what is waiting to be recorded, and waits for every earlier batch too. */
  flush(): Promise<void> {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const items = this.buffer.splice(0);
    if (items.length > 0) {
      this.flushing = this.flushing.then(() =>
        this.options.api.registerSends(items).then(
          () => undefined,
          (error: unknown) => {
            this.options.logger.warn("could not record what the gate decided", {
              error: describeError(error),
            });
          },
        ),
      );
    }
    return this.flushing;
  }

  /** Reports how a released request ended, without making the page wait for it. */
  reportResult(
    releaseId: string,
    outcome: { status: number | null; error?: string | undefined },
  ): void {
    const sent = this.options.api.sendResult(releaseId, outcome).catch((error: unknown) => {
      this.options.logger.warn("could not record how a send ended", {
        error: describeError(error),
      });
    });
    const tracked = sent.finally(() => this.results.delete(tracked));
    this.results.add(tracked);
  }

  /** Resolves once no request is waiting for a decision. */
  settled(): Promise<void> {
    if (this.pending === 0) return Promise.resolve();
    return new Promise((resolve) => this.idle.push(resolve));
  }

  /** How many requests this run let go. */
  get released(): number {
    return this.releasedCount;
  }

  get waiting(): number {
    return this.pending;
  }

  /** Stops waiting for any person: every hold in progress is refused. The run is over. */
  stop(): void {
    this.stopper.abort();
  }

  /** Waits for every record the gate still owes the server, within a bound. */
  async drain(): Promise<void> {
    await Promise.race([
      Promise.all([this.flush(), ...this.results]),
      new Promise((resolve) => setTimeout(resolve, SETTLE_MS)),
    ]);
  }

  /** Decides one send. The caller lets the request go or fails it as the answer says. */
  async decide(request: OutgoingRequest): Promise<SendOutcome> {
    this.pending += 1;
    const started = this.now();
    try {
      const outcome = await this.decideOnce(request);
      if (outcome.kind === "release") this.releasedCount += 1;
      return outcome;
    } catch (error) {
      this.options.logger.warn("a send could not be decided, so it was refused", {
        error: describeError(error),
      });
      return {
        kind: "refuse",
        note: `${describeRequest(request)} could not be checked and was held back`,
      };
    } finally {
      this.pending -= 1;
      this.options.onHeld(this.now() - started);
      if (this.pending === 0) for (const resolve of this.idle.splice(0)) resolve();
    }
  }

  private async decideOnce(request: OutgoingRequest): Promise<SendOutcome> {
    const { gate, api } = this.options;
    const label = describeRequest(request);
    if (gate.declined.some((declined) => matchesApproved(request, declined))) {
      this.log({ kind: "refused", request, reason: "declined" });
      return {
        kind: "refuse",
        note: `A person declined ${label}. Do not try it again.`,
      };
    }
    if (gate.mode === "record") {
      const [sent] = await api.registerSends([{ kind: "released", request }]);
      if (sent === undefined) throw new Error("the server did not record the send");
      return { kind: "release", releaseId: sent.id };
    }
    const earlier = this.unspentApproval(request);
    if (earlier !== undefined) {
      try {
        const { releaseId } = await api.releaseSend(earlier.id, request);
        this.spent.add(earlier.id);
        this.options.note(`A person approved ${label} earlier, and it was sent.`);
        return { kind: "release", releaseId };
      } catch (error) {
        if (!mismatch(error)) throw error;
        // The server does not accept it as the approved request, so a person is asked again.
      }
    }
    return this.holdLive(request, label);
  }

  private unspentApproval(request: OutgoingRequest): ApprovedSend | undefined {
    return this.options.gate.approved.find(
      (approved) => !this.spent.has(approved.id) && matchesApproved(request, approved.request),
    );
  }

  private async holdLive(request: OutgoingRequest, label: string): Promise<SendOutcome> {
    const { api, gate } = this.options;
    const screenshot = gate.holdMs > 0 ? await this.options.capture() : undefined;
    const [held] = await api.registerSends([
      {
        kind: "held",
        request,
        holdMs: gate.holdMs,
        ...(screenshot ? { screenshot } : {}),
      },
    ]);
    if (held === undefined) throw new Error("the server did not record the held request");
    this.options.note(`The page tried to send your details to ${label}. It was held back.`);
    if (held.status !== "pending_live") {
      return { kind: "lapse", note: `${label} was left for a later run` };
    }
    // The server keeps the hold by its own clock and says when it has run out. This side keeps
    // its own count, never the server's timestamp, so a clock that differs cannot end a hold early.
    const startedAt = this.now();
    const limit = gate.holdMs + HOLD_GRACE_MS;
    const stop = AbortSignal.any([this.options.signal, this.stopper.signal]);
    for (;;) {
      if (stop.aborted) {
        return { kind: "refuse", note: `${label} was held back and the run stopped` };
      }
      const left = limit - (this.now() - startedAt);
      if (left <= 0) return { kind: "lapse", note: `${label} was left for a later run` };
      const answer = await api.awaitDecision(held.id, Math.min(POLL_MS, left), stop);
      if (answer.status === "send") return this.release(held.id, request, label);
      if (answer.status === "dont_send") {
        return { kind: "refuse", note: `A person declined ${label}. Do not try it again.` };
      }
      if (answer.status === "expired") {
        return { kind: "lapse", note: `${label} was left for a later run` };
      }
    }
  }

  private async release(
    heldId: string,
    request: OutgoingRequest,
    label: string,
  ): Promise<SendOutcome> {
    try {
      const { releaseId } = await this.options.api.releaseSend(heldId, request);
      this.options.note(`A person approved ${label}, and it was sent.`);
      return { kind: "release", releaseId, heldId };
    } catch (error) {
      if (!mismatch(error)) throw error;
      return { kind: "refuse", note: `${label} no longer matched what the person approved` };
    }
  }

  /** The page took a held request back before it could be let go. */
  async withdrawn(heldId: string | undefined, releaseId: string): Promise<void> {
    const outcome = { status: null, error: "withdrawn by the page" };
    await this.options.api.sendResult(releaseId, outcome);
    if (heldId !== undefined) await this.options.api.sendResult(heldId, outcome);
  }
}
