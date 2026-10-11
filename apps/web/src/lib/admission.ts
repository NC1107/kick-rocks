import type { IgnoreRule, MessageAdmission } from "@kickrocks/shared";

/** Why Kick Rocks took a message in, in words for the person. */
export const ADMISSION_REASON: Record<MessageAdmission, string> = {
  thread: "Answers a message you sent",
  reference: "Names one of your reference numbers",
  alias: "Sent to your reply address",
  bounce: "A delivery failure for mail you sent",
  awaiting_confirmation: "Looks like a form confirmation",
  target_sender: "From a company you asked",
  named_target: "Names a company you asked, about your data",
  person: "You took it in by hand",
};

/** Why the intake rules passed over a message, in words for the person. */
export const IGNORE_RULE_REASON: Record<IgnoreRule, string> = {
  bulk_no_privacy: "Bulk mail that says nothing about privacy",
  company_not_privacy: "Company mail that is not about privacy",
  finished_request: "From a target whose request is finished",
  not_named: "Names no open request",
  stranger_bulk: "Bulk mail from a sender you have no request with",
  bounce_not_ours: "A delivery failure for mail Kick Rocks did not send",
  no_wording_found: "No privacy wording found in it",
};
