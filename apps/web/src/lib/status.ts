import type { RequestStatus, TaskStatus } from "@kickrocks/shared";
import {
  Ban,
  BellRing,
  Check,
  CircleCheck,
  CircleDashed,
  CircleSlash2,
  CircleX,
  Clock3,
  Hourglass,
  Loader,
  type LucideIcon,
  MailX,
  OctagonAlert,
  Pause,
  SearchX,
  Send,
  ShieldAlert,
  Undo2,
} from "lucide-react";
import type { Tone } from "./tone.js";

export interface StatusMeta {
  label: string;
  tone: Tone;
  icon: LucideIcon;
  /** One sentence for a tooltip: what this status means for the person. */
  description: string;
}

/**
 * Typed as a Record over every status, so adding a status to the shared state machine fails to
 * compile here until it has a label, a tone, and an icon. Color is never the only signal: each
 * status also has its own icon and its own words.
 */
export const REQUEST_STATUS_META: Record<RequestStatus, StatusMeta> = {
  draft: {
    label: "Draft",
    tone: "neutral",
    icon: CircleDashed,
    description: "Created but not queued yet.",
  },
  queued: {
    label: "Queued",
    tone: "slate",
    icon: Clock3,
    description: "Waiting its turn to be sent.",
  },
  sent: {
    label: "Sent",
    tone: "blue",
    icon: Send,
    description: "Delivered to the company.",
  },
  awaiting_reply: {
    label: "Awaiting reply",
    tone: "indigo",
    icon: Hourglass,
    description: "Sent, and the company has until the due date to answer.",
  },
  confirmed: {
    label: "Confirmed",
    tone: "green",
    icon: CircleCheck,
    description: "The company confirmed it honored the request.",
  },
  no_record: {
    label: "No record",
    tone: "teal",
    icon: SearchX,
    description: "The company says it holds no data about you.",
  },
  needs_verification: {
    label: "Needs verification",
    tone: "amber",
    icon: ShieldAlert,
    description: "The company asked for something before it will act.",
  },
  follow_up_due: {
    label: "Follow-up due",
    tone: "violet",
    icon: BellRing,
    description: "No answer in time. A follow-up is ready to send.",
  },
  no_response: {
    label: "No response",
    tone: "sand",
    icon: Undo2,
    description: "The deadline passed without an answer.",
  },
  bounced: {
    label: "Bounced",
    tone: "orange",
    icon: MailX,
    description: "The email could not be delivered.",
  },
  rejected: {
    label: "Rejected",
    tone: "red",
    icon: CircleX,
    description: "The company refused the request.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "neutral",
    icon: Ban,
    description: "You cancelled this request.",
  },
};

export const TASK_STATUS_META: Record<TaskStatus, StatusMeta> = {
  queued: {
    label: "Queued",
    tone: "slate",
    icon: Clock3,
    description: "Waiting for a worker.",
  },
  leased: {
    label: "Running",
    tone: "blue",
    icon: Loader,
    description: "A worker is on it.",
  },
  done: {
    label: "Done",
    tone: "green",
    icon: Check,
    description: "Finished.",
  },
  blocked: {
    label: "Blocked",
    tone: "amber",
    icon: Pause,
    description: "Waiting for you.",
  },
  failed: {
    label: "Failed",
    tone: "red",
    icon: OctagonAlert,
    description: "Gave up after its attempts.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "neutral",
    icon: CircleSlash2,
    description: "Cancelled.",
  },
};
