import { getAlignment } from "mailauth/lib/tools.js";
import type { InboxMessage } from "./types.js";

function aligned(signingDomain: string, domains: readonly string[]): boolean {
  return domains.some((domain) => getAlignment(signingDomain, [domain], false) !== false);
}

/**
 * True when a DKIM signature this server verified was made by one of the given domains or a
 * domain of the same organization. The From address alone is forgeable, and so is any header a
 * sender or a mail provider echoes text into, so only a signature checked here earns a reply the
 * trust that its sender is who it says.
 */
export function senderIsAuthenticated(message: InboxMessage, domains: readonly string[]): boolean {
  return message.dkimDomains.some((signer) => aligned(signer, domains));
}
