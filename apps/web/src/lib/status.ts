import type { RequestStatus, TaskStatus } from "@kickrocks/shared";
import type { Family } from "./tone.js";

/** Where a status sits for the person: waiting on someone else, done, needs them, or broken. */
export type StatusFamily = "progress" | "resolved" | "needs" | "failed" | "closed";

/** Each shape is the same in every theme, so a status reads without its color. */
export type StatusShape =
  | "ring"
  /** Out and being waited on: the ring with a centre dot, so it differs from Queued by shape. */
  | "ring-dot"
  | "dashed-ring"
  | "disc"
  | "dash"
  | "triangle"
  | "square"
  | "running";

export interface StatusMeta {
  label: string;
  family: StatusFamily;
  shape: StatusShape;
  /** One sentence for a tooltip: what this status means for the person. */
  description: string;
}

/**
 * Typed as a Record over every status, so adding a status to the shared state machine fails to
 * compile here until it has a label, a family, and a shape. Color is never the only signal: each
 * status also has its own shape and its own words.
 */
export const REQUEST_STATUS_META: Record<RequestStatus, StatusMeta> = {
  draft: {
    label: "Draft",
    family: "progress",
    shape: "dashed-ring",
    description: "Created but not queued yet.",
  },
  queued: {
    label: "Queued",
    family: "progress",
    shape: "ring",
    description: "Waiting its turn to be sent.",
  },
  sent: {
    label: "Sent",
    family: "progress",
    shape: "ring-dot",
    description: "Delivered to the company.",
  },
  awaiting_reply: {
    label: "Awaiting reply",
    family: "progress",
    shape: "ring-dot",
    description: "Sent, and the company has until the due date to answer.",
  },
  confirmed: {
    label: "Confirmed",
    family: "resolved",
    shape: "disc",
    description: "The company confirmed it honored the request.",
  },
  no_record: {
    label: "No record",
    family: "resolved",
    shape: "disc",
    description: "The company says it holds no data about you.",
  },
  needs_verification: {
    label: "Needs verification",
    family: "needs",
    shape: "triangle",
    description: "The company asked for something before it will act.",
  },
  follow_up_due: {
    label: "Follow-up due",
    family: "needs",
    shape: "triangle",
    description: "No answer in time. A follow-up is ready to send.",
  },
  no_response: {
    label: "No response",
    family: "needs",
    shape: "triangle",
    description: "The deadline passed without an answer.",
  },
  bounced: {
    label: "Bounced",
    family: "failed",
    shape: "square",
    description: "The email could not be delivered.",
  },
  rejected: {
    label: "Rejected",
    family: "failed",
    shape: "square",
    description: "The company refused the request.",
  },
  cancelled: {
    label: "Cancelled",
    family: "closed",
    shape: "dash",
    description: "You cancelled this request.",
  },
};

export const TASK_STATUS_META: Record<TaskStatus, StatusMeta> = {
  queued: {
    label: "Queued",
    family: "progress",
    shape: "ring",
    description: "Waiting for a worker.",
  },
  leased: {
    label: "Running",
    family: "progress",
    shape: "running",
    description: "A worker is on it.",
  },
  done: {
    label: "Done",
    family: "resolved",
    shape: "disc",
    description: "Finished.",
  },
  blocked: {
    label: "Blocked",
    family: "needs",
    shape: "triangle",
    description: "Waiting for you.",
  },
  failed: {
    label: "Failed",
    family: "failed",
    shape: "square",
    description: "Gave up after its attempts.",
  },
  cancelled: {
    label: "Cancelled",
    family: "closed",
    shape: "dash",
    description: "Cancelled.",
  },
};

/** The shape that stands for each state family wherever a bare indicator is shown without a word. */
export const TONE_SHAPE: Record<Family, StatusShape> = {
  neutral: "ring",
  positive: "disc",
  attention: "triangle",
  danger: "square",
};
