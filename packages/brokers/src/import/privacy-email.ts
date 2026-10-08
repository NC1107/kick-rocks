import { normalizeDomain } from "@kickrocks/shared";
import { z } from "zod";

/** Words that make a mailbox name a place to send a privacy or data request. */
const PRIVACY_WORDS = [
  "privacy",
  "privcy",
  "dataprotection",
  "optout",
  "opt-out",
  "opt_out",
  "datarequest",
  "datagovernance",
  "databroker",
  "compliance",
  "legal",
  "consumer",
  "california",
  "ccpa",
  "cpra",
  "gdpr",
  "dsar",
  "dsr",
  "drop",
  "remove",
  "unsubscribe",
  "support",
  "customercare",
  "customerservice",
];

/** Generic inbox names that are short enough to match only as a whole word of the mailbox name. */
const GENERIC_INBOXES = new Set([
  "info",
  "dpo",
  "data",
  "contact",
  "hello",
  "service",
  "notice",
  "policy",
  "rights",
  "inquiries",
  "trust",
  "request",
  "requests",
]);

function localPartLooksLikePrivacyInbox(localPart: string): boolean {
  const name = localPart.toLowerCase().split("+")[0] ?? "";
  if (PRIVACY_WORDS.some((word) => name.includes(word))) return true;
  return name.split(/[^a-z]+/).some((word) => GENERIC_INBOXES.has(word));
}

function hostBelongsTo(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/**
 * Registries and directories list whoever filed the form, so a contact can be a named person or an
 * accounting or security inbox, or sit on an unrelated company's host. Mail to those would reach
 * someone who cannot act on a deletion request, so only a mailbox that is plausibly a privacy
 * inbox on the broker's own organization counts. Anything else falls back to the broker's form.
 */
export function usablePrivacyEmail(
  candidates: string,
  ownDomains: readonly (string | null)[],
): string | null {
  const domains = ownDomains.filter((domain): domain is string => domain !== null);
  for (const candidate of candidates.split(/[;,\s]+/)) {
    if (!z.email().safeParse(candidate).success) continue;
    const [localPart = "", host = ""] = candidate.split("@");
    const normalizedHost = normalizeDomain(host);
    if (!normalizedHost || !localPartLooksLikePrivacyInbox(localPart)) continue;
    if (domains.some((domain) => hostBelongsTo(normalizedHost, domain))) return candidate;
  }
  return null;
}
