import { isOnDomain, registrableDomain, withoutSharedHosts } from "@kickrocks/shared";
import { COMMON_WORDS } from "./common-words.js";
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
const MIN_EXACT_LENGTH = 2;
/** A name of only generic words is kept whole when it runs this long, as "USA People Search" does. */
const MIN_GENERIC_NAME_WORDS = 3;
/** Between fields of one text, so a name cannot run from the end of one into the start of the next. */
const FIELD_BREAK = "\u0000";

/** Lowercase with accents folded and apostrophes dropped, so "Équifax" and "Macy’s" are "equifax" and "macys". */
export function fold(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/['’ʼ`´]/g, "");
}

const wordsOf = (text: string) => fold(text).match(/[a-z0-9]+/g) ?? [];

/** "and" is how "&" is read aloud, so neither is part of a name. */
const nameWordsOf = (text: string) => wordsOf(text).filter((word) => word !== "and");

const isNumeric = (words: string[]) => words.every((word) => /^[0-9]+$/.test(word));

/** "Chase (JPMorgan Chase)" is two names, and a leading "The" is no part of one. */
function partsOf(candidate: string): string[][] {
  return candidate
    .split(/[()]/)
    .map((part) => nameWordsOf(part))
    .map((words) => (words[0] === "the" ? words.slice(1) : words))
    .filter((words) => words.length > 0)
    .map(withoutEndings);
}

function withoutEndings(words: string[]): string[] {
  const kept = [...words];
  while (kept.length > 1 && CORPORATE_ENDINGS.has(kept[kept.length - 1] as string)) kept.pop();
  return kept;
}

const labelOf = (domain: string) => registrableDomain(domain).split(".")[0] ?? "";

const isCommon = (words: string[]) => words.length === 1 && COMMON_WORDS.has(words[0] as string);

/**
 * The names a target answers to: its own, the lead of it that its domain spells, its owner group,
 * and any curated alias. A bare word is kept only when it is not one anybody uses in everyday
 * writing, since "here" or "start" in a mail says nothing about who wrote it.
 */
export function namesOf(request: NamedRequest): string[] {
  const brands = request.brands ?? [];
  const labels = new Set(
    withoutSharedHosts([request.targetDomain, ...request.curatedReplyDomains]).map(labelOf),
  );
  const names = new Set<string>();
  const add = (words: string[], { curated }: { curated: boolean }) => {
    if (isNumeric(words)) return;
    if (!curated && isCommon(words)) return;
    if (!curated && words.every((word) => GENERIC_WORDS.has(word))) {
      if (words.length < MIN_GENERIC_NAME_WORDS) return;
    }
    if (words.join("").length >= MIN_NAME_LENGTH) names.add(words.join(" "));
  };
  for (const words of partsOf(request.targetName)) {
    add(words, { curated: false });
    for (let length = 1; length < words.length; length++) {
      const lead = words.slice(0, length);
      if (labels.has(lead.join(""))) add(lead, { curated: false });
    }
  }
  for (const brand of brands) {
    if (brand.includes(".")) add([labelOf(brand)], { curated: false });
    else for (const words of partsOf(brand)) add(words, { curated: true });
  }
  return [...names];
}

const shortExact = (text: string) => text.replace(/[^A-Za-z0-9]/g, "").length;

/**
 * Names too short to match as folded words, kept as written and matched with their case, so "HP"
 * or "H&M" counts but a stray "hp" does not. Only the target's own name and curated aliases.
 */
export function exactNamesOf(request: NamedRequest): string[] {
  const written = [request.targetName, ...(request.brands ?? []).filter((b) => !b.includes("."))];
  return [
    ...new Set(
      written
        .flatMap((name) => name.split(/[()]/))
        .map((part) => part.trim())
        .filter(
          (part) => shortExact(part) >= MIN_EXACT_LENGTH && shortExact(part) < MIN_NAME_LENGTH,
        ),
    ),
  ];
}

const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Between two words of a name: nothing, a space, a dash or dot, an ampersand, or "and". */
const WORD_BREAK = "(?:[\\s._-]*|\\s*&\\s*|[\\s._-]*and[\\s._-]*)";
/** A name this short, as "AT&T" is, would otherwise match two ordinary words with a space between. */
const SHORT_NAME_LETTERS = 4;
const TIGHT_BREAK = "(?:\\s*&\\s*)?";

/** Whole words only; the words of a name may run together or be split by a dash, dot or "&". */
function nameExpression(name: string): string {
  const words = name.split(" ");
  const gap = name.replaceAll(" ", "").length <= SHORT_NAME_LETTERS ? TIGHT_BREAK : WORD_BREAK;
  const pattern = words.map(escapeRegex).join(gap);
  return `(?<![a-z0-9])${pattern}(?![a-z0-9])`;
}

function domainExpression(domain: string): string {
  return `(?<![a-z0-9-])${escapeRegex(domain)}(?![a-z0-9-])`;
}

function exactExpression(name: string): string {
  const pattern = escapeRegex(name.replace(/\s+/g, " "))
    .replace(/&/g, "\\s*&\\s*")
    .replace(/ /g, "\\s+");
  return `(?<![A-Za-z0-9])${pattern}(?![A-Za-z0-9])`;
}

interface Matchers {
  folded: RegExp | null;
  exact: RegExp | null;
}

const compiled = new WeakMap<object, Matchers>();

const alternation = (patterns: string[], flags = "") =>
  patterns.length === 0 ? null : new RegExp(patterns.join("|"), flags);

function matchersOf(request: NamedRequest): Matchers {
  let found = compiled.get(request);
  if (!found) {
    found = {
      folded: alternation([
        ...namesOf(request).map(nameExpression),
        ...domainsOf(request).map(domainExpression),
      ]),
      exact: alternation(exactNamesOf(request).map(exactExpression)),
    };
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

/** Text prepared once for matching against many requests, so it is folded once, not once per request. */
export interface Searchable {
  raw: string;
  folded: string;
}

export function searchable(...fields: (string | null)[]): Searchable {
  const raw = fields.map((field) => field ?? "").join(FIELD_BREAK);
  return { raw, folded: fold(raw) };
}

/** Whether a prepared text names the target or one of its domains as a whole word. */
export function mentionsIn(request: NamedRequest, text: Searchable): boolean {
  const { folded, exact } = matchersOf(request);
  return Boolean(folded?.test(text.folded) || exact?.test(text.raw));
}

/** Whether a text names the target or one of its domains as a whole word. */
export function mentionsTarget(request: NamedRequest, text: string): boolean {
  return text !== "" && mentionsIn(request, searchable(text));
}

/**
 * Whether a mail names the request's target in its subject, its body, the name it was sent under
 * or the domain it was sent from. A company that was written to answers under its own name at
 * least once, so mail that never does is not trusted to be about the request.
 */
export function namesRequest(
  request: NamedRequest,
  mail: Naming,
  prepared: Searchable = preparedNaming(mail),
): boolean {
  return addressIsTarget(mail.fromAddress, request) || mentionsIn(request, prepared);
}

export const preparedNaming = (mail: Naming): Searchable =>
  searchable(mail.subject, mail.fromName, mail.body);
