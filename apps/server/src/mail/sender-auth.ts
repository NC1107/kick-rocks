import { isOnDomain } from "@kickrocks/shared";
import type { InboxMessage } from "./types.js";

function onDomain(host: string, domain: string): boolean {
  return host !== "" && isOnDomain(`https://${host}/`, domain);
}

function propertyValues(result: string, property: string): string[] {
  const pattern = new RegExp(`${property}=("?)([^\\s;"]+)\\1`, "gi");
  return [...result.matchAll(pattern)].map((found) => (found[2] ?? "").toLowerCase());
}

/**
 * True when the user's mail provider vouched for the sender with a DKIM or DMARC pass that names
 * one of the given domains. The From address alone is forgeable, so only this earns a reply the
 * trust that its sender is who it says.
 */
export function senderIsAuthenticated(message: InboxMessage, domains: string[]): boolean {
  const header = message.headers["authentication-results"];
  if (!header) return false;
  return header
    .split(";")
    .map((part) => part.trim().toLowerCase())
    .some((result) => {
      const names = (property: string) =>
        propertyValues(result, property).some((host) => domains.some((d) => onDomain(host, d)));
      if (/(^|\s)dmarc=pass\b/.test(result)) return names("header\\.from");
      if (/(^|\s)dkim=pass\b/.test(result)) return names("header\\.d");
      return false;
    });
}
