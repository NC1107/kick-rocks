import {
  matchesApproved,
  type OutgoingRequest,
  type RegisteredSend,
  type SendRegistration,
  type WorkerDecision,
} from "@kickrocks/shared";
import { WorkerApiError } from "@kickrocks/worker/dist/api-client.js";
import type { SendsApi } from "../src/outbound/held.js";

export type Decision = "send" | "dont_send" | "nobody";

interface Held {
  id: string;
  request: OutgoingRequest;
  expiresAt: number;
  decision: Decision | null;
  released: boolean;
}

/**
 * Stands in for the server's side of the gate in a test that has no server. A held request is
 * answered by `decide`, which may say nobody is home, and a release is accepted only for a request
 * that was approved, the way the server accepts one.
 */
export class FakeSends implements SendsApi {
  readonly registered: SendRegistration[] = [];
  readonly held: Held[] = [];
  readonly releases: { id: string; request: OutgoingRequest }[] = [];
  readonly results: { id: string; status: number | null; error?: string | undefined }[] = [];
  private nextId = 0;

  constructor(
    private readonly decide: (request: OutgoingRequest, index: number) => Decision = () => "send",
    /** Approvals from an earlier run that the fake accepts a release for. */
    private readonly approved: { id: string; request: OutgoingRequest }[] = [],
  ) {}

  async registerSends(items: SendRegistration[]): Promise<RegisteredSend[]> {
    return items.map((item): RegisteredSend => {
      this.registered.push(item);
      this.nextId += 1;
      const id = `send-${this.nextId}`;
      if (item.kind === "held") {
        this.held.push({
          id,
          request: item.request,
          expiresAt: Date.now() + item.holdMs,
          decision: this.decide(item.request, this.held.length),
          released: false,
        });
        return item.holdMs > 0
          ? {
              id,
              status: "pending_live",
              expiresAt: new Date(Date.now() + item.holdMs).toISOString(),
            }
          : { id, status: "awaiting_next_run", expiresAt: null };
      }
      return { id, status: item.kind === "released" ? "releasing" : "done", expiresAt: null };
    });
  }

  async awaitDecision(
    sendId: string,
    waitMs: number,
    signal: AbortSignal,
  ): Promise<WorkerDecision> {
    const held = this.held.find((entry) => entry.id === sendId);
    if (held === undefined) return { status: "expired" };
    if (held.decision === "send") return { status: "send" };
    if (held.decision === "dont_send") return { status: "dont_send" };
    const until = Math.min(held.expiresAt, Date.now() + waitMs);
    while (Date.now() < until && !signal.aborted) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return Date.now() >= held.expiresAt ? { status: "expired" } : { status: "pending" };
  }

  async releaseSend(sendId: string, request: OutgoingRequest): Promise<{ releaseId: string }> {
    const held = this.held.find((entry) => entry.id === sendId);
    if (held !== undefined && held.decision === "send" && !held.released) {
      if (held.request.bodyDigest === request.bodyDigest) {
        held.released = true;
        this.releases.push({ id: sendId, request });
        return { releaseId: `release-${this.releases.length}` };
      }
    }
    const earlier = this.approved.find((entry) => entry.id === sendId);
    if (earlier !== undefined && matchesApproved(request, earlier.request)) {
      this.approved.splice(this.approved.indexOf(earlier), 1);
      this.releases.push({ id: sendId, request });
      return { releaseId: `release-${this.releases.length}` };
    }
    throw new WorkerApiError(409, "send_mismatch", "That is not the request that was approved");
  }

  async sendResult(
    sendId: string,
    outcome: { status: number | null; error?: string | undefined },
  ): Promise<void> {
    this.results.push({ id: sendId, ...outcome });
  }

  get lookups(): OutgoingRequest[] {
    return this.registered.flatMap((item) =>
      item.kind === "lookup" && "method" in item.request ? [item.request] : [],
    );
  }

  get refusals(): { request: SendRegistration["kind"]; reason: string | undefined }[] {
    return this.registered.flatMap((item) =>
      item.kind === "refused" ? [{ request: item.kind, reason: item.reason }] : [],
    );
  }
}
