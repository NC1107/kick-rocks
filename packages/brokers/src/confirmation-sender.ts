import { isOnDomain, isSharedMailHost } from "@kickrocks/shared";
import { getAlignment } from "mailauth/lib/tools.js";

/** True when `domain` is one of `domains` or shares an organizational domain with one. */
export function alignsWithAny(domain: string, domains: readonly string[]): boolean {
  return domains.some((listed) => getAlignment(domain, [listed], false) !== false);
}

/**
 * Whether mail from `sender` may confirm a removal for a target: it is the target's own
 * organizational domain (relaxed alignment over the public suffix list) or on one of the
 * target's curated reply domains, and never a shared host.
 */
export function isTrustedConfirmationDomain(
  sender: string,
  targetDomain: string,
  replyDomains: readonly string[],
): boolean {
  const from = sender.trim().toLowerCase();
  if (from === "" || isSharedMailHost(from)) return false;
  return (
    alignsWithAny(from, [targetDomain]) ||
    replyDomains.some((listed) => isOnDomain(`https://${from}/`, listed))
  );
}
