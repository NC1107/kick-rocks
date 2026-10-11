import { ReplyClassification } from "@kickrocks/shared";

export const LABELS: readonly ReplyClassification[] = ReplyClassification.options;

export function isLabel(value: unknown): value is ReplyClassification {
  return ReplyClassification.safeParse(value).success;
}

/** What each class means, in the words the production prompt uses, so models are asked the same thing. */
export const LABEL_DESCRIPTIONS: Record<ReplyClassification, string> = {
  bounce: "the mail system could not deliver our message",
  auto_ack:
    "an automatic acknowledgement or out-of-office reply that says the request arrived but gives no decision",
  confirmation_link:
    "asks the sender of the request to click a link to confirm it, whatever word it uses: confirm, verify, validate, approve or activate",
  verification_required:
    "asks for identity details or documents before acting; a message that only asks for a click on a link is not this",
  completed: "the data was removed or deleted, or the person was opted out",
  no_record: "they found no record about the person",
  rejected: "they decline to act on the request",
  needs_form:
    "they say the request must be made through a web form, a portal or by phone instead of by email",
  unrelated: "not about a privacy request: marketing, newsletters, personal mail, notices",
  unknown: "the message is about a request but it cannot be told what it says",
};
