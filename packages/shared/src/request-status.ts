import { z } from "zod";

export const RequestStatus = z.enum([
  "draft",
  "queued",
  "sent",
  "awaiting_reply",
  "confirmed",
  "rejected",
  "needs_verification",
  "no_record",
  "bounced",
  "no_response",
  "follow_up_due",
  "cancelled",
]);
export type RequestStatus = z.infer<typeof RequestStatus>;

export const RequestRight = z.enum(["opt_out", "delete"]);
export type RequestRight = z.infer<typeof RequestRight>;

export const RequestChannel = z.enum(["email", "form"]);
export type RequestChannel = z.infer<typeof RequestChannel>;

const TERMINAL: ReadonlySet<RequestStatus> = new Set(["confirmed", "no_record", "cancelled"]);

const TRANSITIONS: Record<RequestStatus, readonly RequestStatus[]> = {
  draft: ["queued", "cancelled"],
  queued: ["sent", "cancelled"],
  sent: ["awaiting_reply", "bounced", "cancelled"],
  awaiting_reply: [
    "confirmed",
    "rejected",
    "needs_verification",
    "no_record",
    "bounced",
    "no_response",
    "cancelled",
  ],
  // A rejection can be appealed by sending again with more context.
  rejected: ["queued", "cancelled"],
  // A human supplies what the broker asked for, then the request goes out again.
  needs_verification: ["sent", "cancelled"],
  no_record: [],
  // A bounce means the channel is dead; the request is re-queued on another channel.
  bounced: ["queued", "cancelled"],
  no_response: ["follow_up_due", "cancelled"],
  follow_up_due: ["queued", "cancelled"],
  confirmed: [],
  cancelled: [],
};

export function nextStatuses(from: RequestStatus): readonly RequestStatus[] {
  return TRANSITIONS[from] ?? [];
}

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return nextStatuses(from).includes(to);
}

export function isTerminalStatus(status: RequestStatus): boolean {
  return TERMINAL.has(status);
}
