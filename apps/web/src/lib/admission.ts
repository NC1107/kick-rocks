import type { IgnoreRule, MessageAdmission } from "@kickrocks/shared";

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

/** Why the intake rules passed over a message, in words for the person. */
export const IGNORE_RULE_REASON: Record<IgnoreRule, string> = {
  bulk_no_privacy: "Bulk mail that says nothing about privacy",
  company_not_privacy: "Company mail that is not about privacy",
  finished_request: "From a target whose request is finished",
  not_named: "Names no target with an open request",
  stranger_bulk: "Bulk mail from a sender you have no request with",
  bounce_not_ours: "A delivery failure for mail Kick Rocks did not send",
  no_wording_found: "No privacy wording found in it",
};
