import { getAlignment } from "mailauth/lib/tools.js";
import type { InboxMessage } from "./types.js";

/** True when `signingDomain` is one of `domains` or shares an organizational domain with one. */
export function alignsWithAny(signingDomain: string, domains: readonly string[]): boolean {
  return domains.some((domain) => getAlignment(signingDomain, [domain], false) !== false);
}

/**
 * True when a DKIM signature this server verified was made by one of the given domains or a
 * domain of the same organization, and covers a To or Cc naming `recipient`. The From address
 * alone is forgeable, and so is any header a sender or a mail provider echoes text into, so only
 * a signature checked here earns a reply the trust that its sender is who it says. A signature
 * that does not name this mailbox would also vouch for a genuine reply to someone else that an
 * attacker forwards in.
 */
export async function senderIsAuthenticated(
  message: InboxMessage,
  domains: readonly string[],
  recipient: string,
): Promise<boolean> {
  const signers = await message.verifyDkim({ domains, recipient });
  return signers.some((signer) => alignsWithAny(signer, domains));
}
