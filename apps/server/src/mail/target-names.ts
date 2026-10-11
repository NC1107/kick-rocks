import { isOnDomain, registrableDomain, withoutSharedHosts } from "@kickrocks/shared";
import type { ClassifierRequest } from "./types.js";

/** What names a request in a piece of mail, kept apart from the request so each rule sees one set. */
export interface Naming {
  subject: string;
  fromName: string | null;
  fromAddress: string;
  /** The part the sender wrote, without the quoted copy of our own request. */
  body: string;
}

type NamedRequest = Pick<
  ClassifierRequest,
  | "targetName"
  | "targetDomain"
  | "replyDomains"
  | "curatedReplyDomains"
  | "replyAddresses"
  | "targetId"
  | "brands"
>;

/**
 * Words many targets share, so a name made of nothing else says nothing about who wrote. The
 * corporate endings come off a legal name; the rest are why a bare "Data" or "Global" never counts.
 */
const CORPORATE_ENDINGS = new Set([
  "inc",
  "llc",
  "ltd",
  "limited",
  "corp",
  "corporation",
  "co",
  "company",
  "gmbh",
  "plc",
  "lp",
  "llp",
  "sa",
  "ag",
  "bv",
  "holdings",
  "group",
  "the",
  "of",
  "and",
  "com",
]);
const GENERIC_WORDS = new Set([
  ...CORPORATE_ENDINGS,
  "data",
  "solutions",
  "media",
  "marketing",
  "services",
  "direct",
  "information",
  "digital",
  "global",
  "analytics",
  "labs",
  "us",
  "usa",
  "technologies",
  "technology",
  "resources",
  "lists",
  "list",
  "systems",
  "insights",
  "credit",
  "exchange",
  "partners",
  "consulting",
  "national",
  "integrated",
  "american",
  "america",
  "international",
  "research",
  "network",
  "first",
  "risk",
  "health",
  "mobile",
  "people",
  "background",
  "search",
  "records",
  "public",
  "online",
  "interactive",
  "ventures",
  "advantage",
  "strategies",
  "science",
  "connect",
  "commerce",
  "leads",
  "app",
  "ai",
  "intelligence",
  "management",
  "finder",
  "directory",
  "report",
  "reports",
  "check",
  "checks",
  "verify",
  "info",
  "web",
  "net",
  "mail",
  "email",
  "free",
  "my",
  "one",
  "smart",
  "all",
  "blue",
  "i",
  "a",
  "s",
  "c",
  "de",
]);

const MIN_NAME_LENGTH = 3;

/** Lowercase with accents folded, so "Équifax" and "equifax" are one word. */
export function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase();
}

const wordsOf = (text: string) => fold(text).match(/[a-z0-9]+/g) ?? [];

/** "Chase (JPMorgan Chase)" is two names, and a leading "The" is no part of one. */
function partsOf(candidate: string): string[] {
  return candidate
    .split(/[()]/)
    .map((part) => wordsOf(part))
    .map((words) => (words[0] === "the" ? words.slice(1) : words))
    .filter((words) => words.length > 0)
    .map((words) => words.join(" "));
}

function withoutEndings(words: string[]): string[] {
  const kept = [...words];
  while (kept.length > 1 && CORPORATE_ENDINGS.has(kept[kept.length - 1] as string)) kept.pop();
  return kept;
}

const labelOf = (domain: string) => registrableDomain(domain).split(".")[0] ?? "";

/**
 * The names a target answers to: its own, the lead label of each of its domains and its owner
 * group, and any curated alias. A name made only of generic words is left out.
 */
export function namesOf(request: NamedRequest): string[] {
  const own = withoutSharedHosts([request.targetDomain, ...request.curatedReplyDomains]);
  const brands = request.brands ?? [];
  const derived = [
    request.targetName,
    ...own.map(labelOf),
    ...brands.filter((brand) => brand.includes(".")).map(labelOf),
  ];
  // An alias is entered by hand because the target is known to answer to it, so it is kept even
  // when its words are common.
  const curated = brands.filter((brand) => !brand.includes("."));
  const names = new Set<string>();
  const add = (part: string, keepGeneric: boolean) => {
    const words = withoutEndings(part.split(" "));
    if (!keepGeneric && words.every((word) => GENERIC_WORDS.has(word))) return;
    const name = words.join(" ");
    if (name.replaceAll(" ", "").length >= MIN_NAME_LENGTH) names.add(name);
  };
  for (const part of derived.flatMap(partsOf)) add(part, false);
  for (const part of curated.flatMap(partsOf)) add(part, true);
  return [...names];
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole words only; the words of a name may run together or be split by a dash or dot. */
function nameExpression(name: string): RegExp {
  const words = name.split(" ").map(escapeRegex);
  return new RegExp(`(?<![a-z0-9])${words.join("[\\s._-]*")}(?![a-z0-9])`);
}

function domainExpression(domain: string): RegExp {
  return new RegExp(`(?<![a-z0-9-])${escapeRegex(domain)}(?![a-z0-9-])`);
}

const compiled = new WeakMap<object, RegExp[]>();

function expressionsOf(request: NamedRequest): RegExp[] {
  let found = compiled.get(request);
  if (!found) {
    found = [...namesOf(request).map(nameExpression), ...domainsOf(request).map(domainExpression)];
    compiled.set(request, found);
  }
  return found;
}

/** Every domain mail genuinely from the target may come from; a shared mail host proves nothing. */
export function domainsOf(request: NamedRequest): string[] {
  return withoutSharedHosts([
    request.targetDomain,
    ...request.curatedReplyDomains,
    ...request.replyDomains,
  ]);
}

const TICKET_DESK_SUFFIXES = ["zendesk.com", "freshdesk.com", "helpscout.net", "zohodesk.com"];

/** Whether an address belongs to the target: its domains, its listed addresses, or its ticket desk. */
export function addressIsTarget(address: string, request: NamedRequest): boolean {
  const lower = address.trim().toLowerCase();
  const host = lower.split("@").pop() ?? "";
  if (host === "") return false;
  return (
    domainsOf(request).some((domain) => isOnDomain(`https://${host}/`, domain)) ||
    request.replyAddresses.includes(lower) ||
    TICKET_DESK_SUFFIXES.some(
      (suffix) =>
        host.endsWith(`.${suffix}`) && host.split(".")[0] === request.targetId.toLowerCase(),
    )
  );
}

/** Whether a text names the target or one of its domains as a whole word. */
export function mentionsTarget(request: NamedRequest, text: string): boolean {
  if (text === "") return false;
  const folded = fold(text);
  return expressionsOf(request).some((expression) => expression.test(folded));
}

/**
 * Whether a mail names the request's target in its subject, its body, the name it was sent under
 * or the domain it was sent from. A company that was written to answers under its own name at
 * least once, so mail that never does is not trusted to be about the request.
 */
export function namesRequest(request: NamedRequest, mail: Naming): boolean {
  return (
    addressIsTarget(mail.fromAddress, request) ||
    mentionsTarget(request, mail.subject) ||
    mentionsTarget(request, mail.fromName ?? "") ||
    mentionsTarget(request, mail.body)
  );
}
