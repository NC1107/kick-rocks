import {
  type Broker,
  type BrokerCategory,
  contactMethodFor,
  isOnDomain,
  normalizeDomain,
  type Requirement,
  slugify,
  type TargetPriority,
  WebUrl,
} from "@kickrocks/shared";
import { z } from "zod";

/** Markers from the legend at the top of the README, which uses emoji with optional variation selectors. */
const MARKER = {
  crucial: "\u{1F490}",
  high: "☠",
  id: "\u{1F3AB}",
  phone: "\u{1F4DE}",
  paid: "\u{1F4B0}",
} as const;

const VARIATION_SELECTOR = /️/g;
const MARKER_CHARS = new Set<string>(Object.values(MARKER));

/** The README sections whose entries are brokers, and what each one means for the category. */
const SECTION_CATEGORY: Readonly<Record<string, BrokerCategory>> = {
  "people search sites": "people-search",
};

/**
 * BADBOOL files these under people search, but none of them publishes a listing a person can find
 * and point at, so a scan-first removal would never find a record and the request would stall.
 */
const CATEGORY_OVERRIDES: Readonly<Record<string, BrokerCategory>> = {
  "acxiom.com": "marketing",
  "zoominfo.com": "marketing",
  "classmates.com": "marketing",
  "facecheck.id": "requires-id",
};

const MIN_ENTRIES = 25;

const LINK = /\[([^\]]*)\]\(([^)\s]*)\)/g;
const ANGLE_LINK = /<((?:mailto:)?[^<>\s@]+@[^<>\s]+|https?:\/\/[^<>\s]+)>/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g;

const STRONG_OPT_OUT_HINT = /opt[\s_-]?out|remov|suppress|do-not-sell|delete|unsubscribe/i;
const WEAK_OPT_OUT_HINT =
  /\bforms?\b|(privacy|control)[\s_-]?(control|privacy|request|rights|center)|cancel/i;
const SEARCH_HINT = /find|search|look|information|your data|your number|view|records?$/i;
const RECORD_URL_HINT =
  /\b(enter|paste|copy|grab|insert|record|submit)\b[^.]*\b(url|urls|link)\b|profile url|link to your profile|url you need/i;

interface Link {
  text: string;
  url: string;
}

export interface BadboolSkip {
  name: string;
  reason: string;
}

export interface BadboolReport {
  brokers: Broker[];
  skipped: BadboolSkip[];
}

interface RawEntry {
  section: string;
  heading: string;
  body: string;
}

function splitEntries(markdown: string): RawEntry[] {
  const entries: RawEntry[] = [];
  let section = "";
  let current: RawEntry | null = null;
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    const h2 = /^##\s+(.+?)\s*$/.exec(line);
    const h3 = /^###\s+(.+?)\s*$/.exec(line);
    if (h2 && !line.startsWith("###")) {
      section = (h2[1] ?? "").trim().toLowerCase();
      current = null;
    } else if (h3) {
      current = { section, heading: h3[1] ?? "", body: "" };
      entries.push(current);
    } else if (current) {
      current.body += `${line}\n`;
    }
  }
  return entries;
}

function parseHeading(heading: string): { name: string; markers: Set<string> } {
  const markers = new Set<string>();
  let rest = heading.replace(VARIATION_SELECTOR, "");
  for (;;) {
    rest = rest.trimStart();
    const first = Array.from(rest)[0];
    if (first === undefined || !MARKER_CHARS.has(first)) break;
    markers.add(first);
    rest = rest.slice(first.length);
  }
  return { name: rest.trim(), markers };
}

function extractLinks(body: string): Link[] {
  const links: Link[] = [];
  for (const match of body.matchAll(LINK)) {
    links.push({ text: (match[1] ?? "").trim(), url: (match[2] ?? "").trim() });
  }
  for (const match of body.matchAll(ANGLE_LINK)) {
    links.push({ text: "", url: (match[1] ?? "").trim() });
  }
  return links;
}

function asWebUrl(value: string): string | null {
  if (/^mailto:/i.test(value) || /^[^/]*@/.test(value)) return null;
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  if (!WebUrl.safeParse(candidate).success) return null;
  try {
    return new URL(candidate).href;
  } catch {
    return null;
  }
}

/** `a.b.example.com` to `example.com`, keeping three labels under the few two-part suffixes in the list. */
function registrable(host: string): string {
  const labels = host.split(".");
  const twoPartSuffix = /^(co|com|org|net|gov|ac)$/.test(labels[labels.length - 2] ?? "");
  return labels.slice(-(twoPartSuffix && labels.length > 2 ? 3 : 2)).join(".");
}

function hostnameOf(url: string): string | null {
  const domain = normalizeDomain(url);
  return domain ? registrable(domain) : null;
}

function emailsIn(text: string): string[] {
  const found = new Set<string>();
  for (const match of text.matchAll(EMAIL)) found.add(match[0].toLowerCase());
  return Array.from(found).filter((address) => z.email().safeParse(address).success);
}

/**
 * The README writes a country-limited address as "Users in X may email". Using it would send a
 * United States request to a desk that answers someone else.
 */
function usableEmails(body: string): string[] {
  const sentences = body.split(/(?<=[.!?])\s+|\n/);
  const out: string[] = [];
  for (const sentence of sentences) {
    if (/\b(users|people|residents|customers)\s+in\b/i.test(sentence)) continue;
    for (const address of emailsIn(sentence)) if (!out.includes(address)) out.push(address);
  }
  return out;
}

function plainText(body: string): string {
  return body
    .replace(LINK, (_, text: string, url: string) => (text.trim() ? text : url))
    .replace(ANGLE_LINK, (_, target: string) => target.replace(/^mailto:/, ""))
    .replace(/\*\*|__|(?<![\w])_(?=\S)|(?<=\S)_(?![\w])/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const HOSTNAME_HEADING = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/i;

function nameKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function pickDomain(name: string, links: Link[]): string | null {
  if (HOSTNAME_HEADING.test(name)) return name.toLowerCase();
  const hosts: string[] = [];
  for (const link of links) {
    if (link.url.startsWith("mailto:")) continue;
    const host = hostnameOf(link.url);
    if (host && !hosts.includes(host)) hosts.push(host);
  }
  const key = nameKey(name);
  const matching = hosts.find((host) => {
    const sld = nameKey(host.split(".")[0] ?? "");
    return sld.length >= 4 && (key.includes(sld) || sld.includes(key));
  });
  return matching ?? hosts[0] ?? null;
}

function classifyLinks(links: Link[], domain: string) {
  const web = links
    .map((link) => ({ ...link, href: asWebUrl(link.url) }))
    .filter((link): link is Link & { href: string } => link.href !== null);
  const matches = (hint: RegExp) => (link: Link & { href: string }) =>
    hint.test(link.text) || hint.test(new URL(link.href).pathname);
  const isOptOut = (link: Link & { href: string }) =>
    matches(STRONG_OPT_OUT_HINT)(link) || matches(WEAK_OPT_OUT_HINT)(link);
  const optOut = [...web.filter(matches(STRONG_OPT_OUT_HINT)), ...web.filter(isOptOut)];
  const search = web.filter(
    (link) =>
      !isOptOut(link) &&
      isOnDomain(link.href, domain) &&
      (SEARCH_HINT.test(link.text) || new URL(link.href).pathname.length <= 1),
  );
  return {
    optOutUrl: optOut[0]?.href ?? null,
    searchUrl: search[0]?.href ?? null,
  };
}

function requirementsFor(
  markers: ReadonlySet<string>,
  body: string,
  hasRecordLink: boolean,
): Requirement[] {
  const found = new Set<Requirement>();
  if (markers.has(MARKER.id)) found.add("id_upload");
  if (markers.has(MARKER.phone)) found.add("phone_call");
  if (markers.has(MARKER.paid)) found.add("paid");
  const text = plainText(body);
  if (/captcha/i.test(text)) found.add("captcha");
  if (/(click|confirm|verify)[^.]*\b(link|email|inbox)\b|\bverification link\b/i.test(text)) {
    found.add("email_confirmation");
  }
  if (/sign up for a free (account|trial)|create an account/i.test(text)) found.add("account");
  if (/\bfax\b/i.test(text)) found.add("fax");
  if (/\bmail in\b|\bmail(ed)? (a|the) (letter|form)\b/i.test(text)) found.add("postal_mail");
  if (hasRecordLink || RECORD_URL_HINT.test(text)) found.add("record_url");
  const order = [
    "email_confirmation",
    "phone_call",
    "id_upload",
    "captcha",
    "account",
    "paid",
    "record_url",
    "postal_mail",
    "fax",
  ] as const;
  return order.filter((requirement) => found.has(requirement));
}

function priorityFor(markers: ReadonlySet<string>): TargetPriority {
  if (markers.has(MARKER.crucial)) return "crucial";
  if (markers.has(MARKER.high)) return "high";
  return "normal";
}

function idFor(name: string): string {
  const base = HOSTNAME_HEADING.test(name) ? name.replace(/\.com$/i, "") : name;
  return slugify(base.replace(/['‘’]/g, ""));
}

/**
 * Parses the pinned BADBOOL README. It throws when the list stops looking like BADBOOL, because a
 * silent empty import would let the merge drop every curated people-search record.
 */
export function parseBadboolReport(markdown: string): BadboolReport {
  const brokers: Broker[] = [];
  const skipped: BadboolSkip[] = [];
  const seenIds = new Set<string>();
  const seenDomains = new Set<string>();
  let considered = 0;
  for (const entry of splitEntries(markdown)) {
    const category = SECTION_CATEGORY[entry.section];
    if (!category) continue;
    const { name, markers } = parseHeading(entry.heading);
    if (!name) continue;
    considered += 1;
    const links = extractLinks(entry.body);
    const domain = pickDomain(name, links);
    if (!domain || !normalizeDomain(domain)) {
      skipped.push({ name, reason: "no domain could be read from the entry" });
      continue;
    }
    if (seenDomains.has(domain)) {
      skipped.push({ name, reason: `domain ${domain} already listed` });
      continue;
    }
    seenDomains.add(domain);
    const { optOutUrl, searchUrl } = classifyLinks(links, domain);
    const emails = usableEmails(entry.body);
    const privacyEmail =
      emails.find((address) => isOnDomain(`https://${address.split("@")[1]}`, domain)) ??
      emails[0] ??
      null;
    const requirements = requirementsFor(markers, entry.body, searchUrl !== null);
    const resolved: BrokerCategory =
      CATEGORY_OVERRIDES[domain] ?? (markers.has(MARKER.id) ? "requires-id" : category);
    let id = idFor(name) || slugify(domain);
    if (seenIds.has(id)) id = `${id}-${slugify(domain)}`;
    seenIds.add(id);
    const notes = plainText(entry.body);
    brokers.push({
      id,
      name,
      category: resolved,
      website: searchUrl ? new URL(searchUrl).origin : `https://${domain}`,
      domain,
      privacyEmail,
      optOutUrl,
      privacyRightsUrl: null,
      searchUrl,
      contactMethod: contactMethodFor(privacyEmail, optOutUrl),
      region: "us",
      requiresId: markers.has(MARKER.id),
      requirements,
      priority: priorityFor(markers),
      regulatedBy: [],
      collectsMinors: null,
      collectsGeolocation: null,
      collectsReproductiveHealth: null,
      metrics: null,
      notes: notes ? `BADBOOL: ${notes}` : null,
      sources: [{ source: "badbool", license: "CC-BY-NC-SA-4.0", upstreamId: name }],
    });
  }
  if (considered < MIN_ENTRIES) {
    throw new Error(
      `BADBOOL README has ${considered} people-search entries, expected at least ${MIN_ENTRIES}; the format may have changed`,
    );
  }
  return { brokers, skipped };
}

export function parseBadbool(markdown: string): Broker[] {
  return parseBadboolReport(markdown).brokers;
}
