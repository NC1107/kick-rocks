import { parseOutgoingMessageId, parseReferences } from "@kickrocks/shared";
import { getAlignment } from "mailauth/lib/tools.js";
import type { ClassifierRequest, InboxMessage, VerifiedSignature } from "./types.js";

/** True when `signingDomain` is one of `domains` or shares an organizational domain with one. */
export function alignsWithAny(signingDomain: string, domains: readonly string[]): boolean {
  return domains.some((domain) => getAlignment(signingDomain, [domain], false) !== false);
}

/**
 * How far a reply's DKIM signatures vouch for it:
 * - `unsigned`: no signature verified over the whole body with a d= aligned with the target.
 * - `signed`: one did, but nothing it covers ties the message to this request, so it could be a
 *   genuine reply to someone else that an attacker forwards in.
 * - `bound`: one did, and that same signature also covers this request's Message-ID in
 *   In-Reply-To or References, or its KR reference in Subject or in the body.
 */
export type SenderTrust = "unsigned" | "signed" | "bound";

const bareId = (id: string) => id.replace(/^<|>$/g, "");

function quotesOutgoingId(values: readonly string[], request: ClassifierRequest): boolean {
  return values
    .flatMap((value) => value.split(/[\s,]+/))
    .filter((token) => token !== "")
    .some(
      (token) =>
        parseOutgoingMessageId(token)?.requestId === request.id ||
        (request.outgoingMessageId !== null && bareId(token) === bareId(request.outgoingMessageId)),
    );
}

function namesReference(texts: readonly string[], request: ClassifierRequest): boolean {
  return texts.some((text) =>
    parseReferences(text).some((reference) => reference === request.reference),
  );
}

/** The body counts because a signature that verified here covers every byte of it. */
function bindsTo(signature: VerifiedSignature, request: ClassifierRequest, body: string): boolean {
  return (
    quotesOutgoingId([...signature.inReplyTo, ...signature.references], request) ||
    namesReference(signature.subject, request) ||
    namesReference([body], request)
  );
}

export async function senderTrust(
  message: InboxMessage,
  request: ClassifierRequest,
  domains: readonly string[],
): Promise<SenderTrust> {
  const aligned = (await message.verifyDkim(domains)).filter((signature) =>
    alignsWithAny(signature.domain, domains),
  );
  if (aligned.length === 0) return "unsigned";
  return aligned.some((signature) => bindsTo(signature, request, message.text))
    ? "bound"
    : "signed";
}
