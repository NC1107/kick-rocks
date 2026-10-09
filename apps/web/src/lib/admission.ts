import type { MessageAdmission } from "@kickrocks/shared";

/** Why Kick Rocks took a message in, in words for the person. */
export const ADMISSION_REASON: Record<MessageAdmission, string> = {
  thread: "It answers a message Kick Rocks sent for one of your requests",
  reference: "It names the reference of one of your requests",
  alias: "It was sent to your Kick Rocks reply address",
  bounce: "It reports that a message Kick Rocks sent could not be delivered",
  awaiting_confirmation: "It looks like the confirmation email a form you submitted is waiting for",
  target_sender: "It is from a company or broker you have a request with",
  named_target: "It names a company you have a request with and talks about your data",
  person: "You took it in by hand",
};
