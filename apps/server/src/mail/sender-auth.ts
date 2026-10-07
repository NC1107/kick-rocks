import { isOnDomain } from "@kickrocks/shared";
import type { InboxMessage } from "./types.js";

function onDomain(host: string, domain: string): boolean {
  return host !== "" && isOnDomain(`https://${host}/`, domain);
}

/**
 * Splits an Authentication-Results value into its ';' separated sections the way RFC 8601 reads
 * it: comments (which nest) vanish and quoted strings stay whole, so text a sender managed to get
 * echoed into the header can neither end a section nor start a fake one. Null when a comment or
 * quote never closes, because nothing in such a header can be told from the sender's own text.
 */
function sectionsOf(header: string): string[] | null {
  const sections: string[] = [];
  let current = "";
  let commentDepth = 0;
  let quoted = false;
  for (let i = 0; i < header.length; i += 1) {
    const char = header.charAt(i);
    if (commentDepth > 0) {
      if (char === "\\") i += 1;
      else if (char === "(") commentDepth += 1;
      else if (char === ")") {
        commentDepth -= 1;
        if (commentDepth === 0) current += " ";
      }
    } else if (quoted) {
      current += char;
      if (char === "\\") {
        i += 1;
        current += header.charAt(i);
      } else if (char === '"') quoted = false;
    } else if (char === "(") commentDepth = 1;
    else if (char === '"') {
      quoted = true;
      current += char;
    } else if (char === ";") {
      sections.push(current);
      current = "";
    } else current += char;
  }
  if (commentDepth > 0 || quoted) return null;
  sections.push(current);
  return sections;
}

function tokensOf(section: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < section.length; i += 1) {
    const char = section.charAt(i);
    if (quoted) {
      current += char;
      if (char === "\\") {
        i += 1;
        current += section.charAt(i);
      } else if (char === '"') quoted = false;
    } else if (/\s/.test(char)) {
      if (current !== "") tokens.push(current);
      current = "";
    } else {
      if (char === '"') quoted = true;
      current += char;
    }
  }
  if (current !== "") tokens.push(current);
  return tokens;
}

/** The domain of a property value, which may be a bare domain or a mailbox with a quoted local part. */
function domainOfValue(value: string): string {
  let rest = value;
  if (rest.startsWith('"')) {
    let end = 1;
    while (end < rest.length && rest.charAt(end) !== '"') end += rest.charAt(end) === "\\" ? 2 : 1;
    const afterQuote = rest.slice(end + 1);
    rest = afterQuote.startsWith("@") ? afterQuote : rest.slice(1, end);
  }
  return (rest.slice(rest.lastIndexOf("@") + 1) || "").toLowerCase();
}

interface Resinfo {
  method: string;
  result: string;
  properties: Map<string, string[]>;
}

function resinfoOf(section: string): Resinfo | null {
  const [first, ...rest] = tokensOf(section);
  const methodSpec = /^([a-z0-9-]+)=([a-z0-9-]+)$/i.exec(first ?? "");
  if (!methodSpec) return null;
  const properties = new Map<string, string[]>();
  for (const token of rest) {
    const spec = /^([a-z0-9-]+\.[a-z0-9-]+)=(.+)$/i.exec(token);
    if (!spec) continue;
    const key = (spec[1] ?? "").toLowerCase();
    properties.set(key, [...(properties.get(key) ?? []), domainOfValue(spec[2] ?? "")]);
  }
  return {
    method: (methodSpec[1] ?? "").toLowerCase(),
    result: (methodSpec[2] ?? "").toLowerCase(),
    properties,
  };
}

function authservIdOf(header: string): string {
  const first = sectionsOf(header)?.[0] ?? "";
  return (tokensOf(first)[0] ?? "").toLowerCase();
}

function isTrustedId(id: string, trustedAuthservIds: string[]): boolean {
  return id !== "" && trustedAuthservIds.some((trusted) => onDomain(id, trusted));
}

/**
 * The Authentication-Results headers the user's own mail provider added, topmost first. RFC 8601
 * lets any hop write this header, so a forger's copy is only ignorable by position and name: the
 * receiving provider prepends its own, so the topmost header carrying one of its authserv-ids
 * starts the run. A provider that writes one header per method (iCloud, Proton) keeps them
 * together, so the run goes on until a Received header or another authserv-id's header breaks it,
 * and everything past that is the sender's to write.
 */
export function trustedAuthenticationResults(
  message: InboxMessage,
  trustedAuthservIds: string[],
): string[] {
  const run: string[] = [];
  let runReceivedAbove = 0;
  for (const [index, header] of message.authenticationResults.entries()) {
    const trusted = isTrustedId(authservIdOf(header), trustedAuthservIds);
    const receivedAbove = message.authenticationReceivedAbove?.[index] ?? 0;
    if (run.length === 0) {
      if (!trusted) continue;
      runReceivedAbove = receivedAbove;
    } else if (!trusted || receivedAbove !== runReceivedAbove) {
      break;
    }
    run.push(header);
  }
  return run;
}

function vouches(header: string, domains: string[]): boolean {
  const sections = sectionsOf(header);
  if (!sections) return false;
  return sections.slice(1).some((section) => {
    const resinfo = resinfoOf(section);
    if (resinfo?.result !== "pass") return false;
    const property =
      resinfo.method === "dmarc" ? "header.from" : resinfo.method === "dkim" ? "header.d" : null;
    if (!property) return false;
    return (resinfo.properties.get(property) ?? []).some((host) =>
      domains.some((domain) => onDomain(host, domain)),
    );
  });
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
  return trustedAuthenticationResults(message, trustedAuthservIds).some((header) =>
    vouches(header, domains),
  );
}
