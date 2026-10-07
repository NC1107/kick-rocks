import { isOnDomain } from "@kickrocks/shared";
import type { InboxMessage } from "./types.js";

function onDomain(host: string, domain: string): boolean {
  return host !== "" && isOnDomain(`https://${host}/`, domain);
}

function propertyValues(result: string, property: string): string[] {
  const pattern = new RegExp(`${property}=("?)([^\\s;"]+)\\1`, "gi");
  return [...result.matchAll(pattern)].map((found) => (found[2] ?? "").toLowerCase());
}

function authservIdOf(header: string): string {
  const first = header.split(";", 1)[0] ?? "";
  return (first.trim().split(/\s+/, 1)[0] ?? "").toLowerCase();
}

/**
 * The Authentication-Results header the user's own mail provider added, or null. RFC 8601 lets any
 * hop write this header, so a forger's copy is only ignorable by position and name: the receiving
 * provider prepends its own, so the topmost header carrying one of its authserv-ids is the one to
 * read, and everything below it, or under any other id, is the sender's to write.
 */
export function trustedAuthenticationResult(
  message: InboxMessage,
  trustedAuthservIds: string[],
): string | null {
  for (const header of message.authenticationResults) {
    const id = authservIdOf(header);
    if (id !== "" && trustedAuthservIds.some((trusted) => onDomain(id, trusted))) return header;
  }
  return null;
}

/**
 * True when the user's mail provider vouched for the sender with a DKIM or DMARC pass that names
 * one of the given domains. The From address alone is forgeable, so only this earns a reply the
 * trust that its sender is who it says. A provider with no known authserv-id vouches for no one.
 */
export function senderIsAuthenticated(
  message: InboxMessage,
  domains: string[],
  trustedAuthservIds: string[],
): boolean {
  const header = trustedAuthenticationResult(message, trustedAuthservIds);
  if (!header) return false;
  return header
    .split(";")
    .slice(1)
    .map((part) => part.trim().toLowerCase())
    .some((result) => {
      const names = (property: string) =>
        propertyValues(result, property).some((host) => domains.some((d) => onDomain(host, d)));
      if (/(^|\s)dmarc=pass\b/.test(result)) return names("header\\.from");
      if (/(^|\s)dkim=pass\b/.test(result)) return names("header\\.d");
      return false;
    });
}
