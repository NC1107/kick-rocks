import {
  ageGap,
  ageSpanInYear,
  agesInText,
  type ProfileFields,
  US_STATES,
  WEAK_AGE_GAP,
} from "@kickrocks/shared";
import { readsAsPagination } from "./pagination.js";
import { CITY_PATTERN } from "./place-pattern.js";

/**
 * What a result card or a record page says, as the page's own text. The words are compared here
 * with the person's real details so the model is told which identifiers fit and never sees a value.
 */
export interface RecordText {
  /** The name the card or page leads with, when it has a heading. */
  heading: string;
  text: string;
}

type Verdict = {
  name: "matches" | "matches as an alias" | "differs" | "not shown" | null;
  place: "found" | "absent" | "not shown" | null;
  birthYear: "matches" | "differs" | "not shown" | null;
  age: "fits" | "does not fit" | "not shown" | "unclear" | null;
};

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
const ALIAS_LABEL =
  /\b(?:also known as|a\.?k\.?a\.?|aliases|alias|formerly|previously known as|maiden name|other names|also called|nee)\b\s*:?/i;
export const RELATIVES_LABEL =
  /\b(?:possible relatives|relatives|relative|associates|associate|related to|family members|household members|neighbors)\b\s*:?/i;

function tokens(text: string): string[] {
  return (
    text
      .toLowerCase()
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[’‘]/g, "'")
      .match(/[a-z0-9]+(?:['-][a-z0-9]+)*/g) ?? []
  );
}

function nameTokens(text: string): string[] {
  return tokens(text).filter((token) => !SUFFIXES.has(token));
}

function personName(fields: ProfileFields): { first: string; last: string } | null {
  const first = nameTokens(fields.first_name ?? "")[0];
  const last = nameTokens(fields.last_name ?? "").at(-1);
  if (first !== undefined && last !== undefined) return { first, last };
  const full = nameTokens(fields.full_name ?? "");
  const [head] = full;
  const tail = full.at(-1);
  return head !== undefined && tail !== undefined && full.length > 1
    ? { first: head, last: tail }
    : null;
}

type NameMatch = "full" | "partial" | "none";

/**
 * A hyphenated name is compared part by part: a page that adds a married surname has shown the
 * person, and a page that shows only one part of a hyphenated name has only shortened it.
 */
function namePartIs(word: string, target: string): 0 | 1 | 2 {
  if (word === target || word.split("-").includes(target)) return 2;
  return target.split("-").includes(word) ? 1 : 0;
}

/**
 * The first and last name in order or as "Last, First", with up to two middle names or initials
 * between. A first initial or a last name cut short to an initial or a prefix is only a partial
 * match, since a site that shortens names has not shown a different person.
 */
function nameMatch(unit: string, name: { first: string; last: string }): NameMatch {
  const words = nameTokens(unit);
  const firstIs = (word: string) =>
    namePartIs(word, name.first) || (word.length === 1 && name.first.startsWith(word) ? 1 : 0);
  const lastIs = (word: string) =>
    namePartIs(word, name.last) || (name.last.startsWith(word) ? 1 : 0);
  let best = 0;
  words.forEach((word, i) => {
    for (const later of words.slice(i + 1, i + 4)) {
      best = Math.max(best, Math.min(firstIs(word), lastIs(later)));
      best = Math.max(best, Math.min(lastIs(word), firstIs(later)));
    }
  });
  return best === 2 ? "full" : best === 1 ? "partial" : "none";
}

function nameIn(unit: string, name: { first: string; last: string }): boolean {
  return nameMatch(unit, name) === "full";
}

export function looksLikeName(text: string): boolean {
  const words = text.split(/[\s,]+/).filter(Boolean);
  if (words.length < 2 || words.length > 6 || text.length > 60) return false;
  if (/,\s*[A-Z]{2}$/.test(text) || US_STATES.some((state) => state.name === text)) return false;
  return words.every((word) => /^\p{Lu}[\p{L}.'-]*$/u.test(word));
}

/** A heading of a block about other people, such as a sidebar of people also viewed. */
const OTHER_PEOPLE_LABEL =
  /^(?:people also (?:viewed|searched)|also viewed|similar (?:people|profiles|records)|people you may know|you may (?:also )?know|related (?:people|searches|profiles)|more people (?:named|with)|others named|other people named|people with (?:a )?similar names?)\b/i;
const ZIP = "(?:\\s+\\d{5}(?:-\\d{4})?)?";
const PLACE_LINE = new RegExp(`^([\\p{L}.' ]+),\\s*([A-Za-z ]+?)${ZIP}$`, "u");

function isStateWord(text: string): boolean {
  return US_STATES.some(
    (state) => state.code === text || state.name.toLowerCase() === text.toLowerCase(),
  );
}

/** A line that is only a place, such as "Austin, TX 78701". */
function isPlaceLine(line: string): boolean {
  const match = PLACE_LINE.exec(line);
  return match !== null && isStateWord((match[2] as string).trim());
}

/** A line of a list of people: it starts with a name, and is not a place. */
function isPersonEntry(line: string): boolean {
  if (isPlaceLine(line)) return false;
  const head = line.split(/\s+(?:[-\u2013\u2014|·]|and)\s+|[,;(|·]|\s+(?:age\b|\d)/i)[0] ?? "";
  return looksLikeName(head.trim());
}

export interface RecordLines {
  /** The page's own lines, without aliases, relatives or blocks about other people. */
  own: string[];
  alias: string[];
  /** The lines of relatives and associates, with the label taken off. */
  relatives: string[];
}

type DetailKind = "place" | "age" | "phone" | "email";
const ALL_DETAILS: readonly DetailKind[] = ["place", "age", "phone", "email"];

function detailKindOf(line: string): DetailKind | null {
  if (isPlaceLine(line)) return "place";
  if (/^(?:age[: ]*)?\d{1,3}$/i.test(line)) return "age";
  if (/^\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}$/.test(line)) return "phone";
  return /^[\w.+-]+@[\w-]+(?:\.[\w-]+)+$/.test(line) ? "email" : null;
}

/**
 * Splits the text into the record's own lines, its aliases and its relatives. A label of relatives
 * or of other people covers the lines under it for as long as they read as entries of a list, so
 * the people listed beside a record are not taken for the record. A name on a line of its own may
 * be followed by its place, its age, its phone and its email, once each; an entry that carries its details
 * on its own line takes no more, so the record's own age after the list is the record's.
 */
export function splitRecordLines(text: string): RecordLines {
  const parts: RecordLines = { own: [], alias: [], relatives: [] };
  let listing: "none" | "people" | "block" = "none";
  let skip = false;
  let details = new Set<DetailKind>();
  for (const raw of text.split(/[\n\t]+/)) {
    let unit = raw.trim();
    if (unit === "") continue;
    if (OTHER_PEOPLE_LABEL.test(unit)) {
      skip = true;
      listing = "none";
      details = new Set();
      continue;
    }
    if (listing !== "none" || skip) {
      const entry = isPersonEntry(unit);
      const kind = detailKindOf(unit);
      const attached =
        !entry && kind !== null && (listing === "block" || skip) && details.has(kind);
      if (entry || attached) {
        if (attached && kind !== null) details.delete(kind);
        if (entry) {
          details = looksLikeName(unit) ? new Set<DetailKind>(ALL_DETAILS) : new Set();
        }
        if (!skip) parts.relatives.push(unit);
        continue;
      }
      listing = "none";
      skip = false;
    }
    const relatives = RELATIVES_LABEL.exec(unit);
    if (relatives) {
      const inline = unit.slice(relatives.index + relatives[0].length).trim();
      if (inline !== "") parts.relatives.push(inline);
      listing = inline === "" ? "block" : "people";
      details = new Set();
      unit = unit.slice(0, relatives.index).trim();
    }
    const alias = ALIAS_LABEL.exec(unit);
    if (alias) {
      const before = unit.slice(0, alias.index).trim();
      if (before !== "") parts.own.push(before);
      parts.alias.push(unit.slice(alias.index + alias[0].length));
      continue;
    }
    if (unit !== "") parts.own.push(unit);
  }
  return parts;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

function stateSpellingsOf(value: string): { code: string; name: string } | null {
  const text = value.trim().toLowerCase();
  return (
    US_STATES.find(
      (state) => state.code.toLowerCase() === text || state.name.toLowerCase() === text,
    ) ?? null
  );
}

const WORD_BEFORE = "(?<![\\p{L}\\p{N}])";
const WORD_AFTER = "(?![\\p{L}\\p{N}])";

/** A state is written by its code in capitals or by its name in any case, and a code is not a word. */
function stateAfter(text: string, value: string): boolean {
  const state = stateSpellingsOf(value);
  const spelled = state ? state.name : value;
  const byName = new RegExp(`^[\\s,]+${escapeRegExp(spelled)}${WORD_AFTER}`, "iu");
  const byCode = state ? new RegExp(`^[\\s,]+${state.code}${WORD_AFTER}`, "u") : null;
  return byName.test(text) || (byCode?.test(text) ?? false);
}

function stateAnywhere(text: string, value: string): boolean {
  const state = stateSpellingsOf(value);
  const spelled = state ? state.name : value;
  const byName = new RegExp(`${WORD_BEFORE}${escapeRegExp(spelled)}${WORD_AFTER}`, "iu");
  const byCode = state ? new RegExp(`,\\s*${state.code}${WORD_AFTER}`, "u") : null;
  return byName.test(text) || (byCode?.test(text) ?? false);
}

/** Codes whose capitals are also a credential or a word, so a bare one counts as a place only with a zip code. */
const AMBIGUOUS_CODES = new Set(["MD", "PA", "DO", "ID", "DC", "OR", "IN", "ME", "OK", "HI", "AL"]);
const CITY = `(${CITY_PATTERN})`;
const WITH_COMMA = new RegExp(`${WORD_BEFORE}${CITY},[ ]*([A-Z]{2})${WORD_AFTER}`, "gu");
const STATE_NAME_ALTERNATIVES = [...US_STATES]
  .sort((a, b) => b.name.length - a.name.length)
  .map((state) => escapeRegExp(state.name))
  .join("|");
const WITH_STATE_NAME = new RegExp(
  `${WORD_BEFORE}${CITY},[ ]*(${STATE_NAME_ALTERNATIVES})${WORD_AFTER}`,
  "gu",
);
const WITHOUT_COMMA = new RegExp(
  `${WORD_BEFORE}${CITY}[ ]+([A-Z]{2})(?:[ ]+(\\d{5})(?:-\\d{4})?)?${WORD_AFTER}`,
  "gu",
);

const STATE_NAME_PATTERNS = US_STATES.map((state) => ({
  code: state.code,
  byName: new RegExp(`${WORD_BEFORE}${escapeRegExp(state.name)}${WORD_AFTER}`, "iu"),
}));

interface ShownPlace {
  /** Null when the text shows only a state. */
  city: string | null;
  code: string;
}

function codeOf(spelling: string): string | null {
  return stateSpellingsOf(spelling)?.code ?? null;
}

/** Every place the text shows: "City, ST", "City ST", "City ST 12345", "City, State", or a state alone. */
function placesShown(lines: readonly string[]): ShownPlace[] {
  const shown: ShownPlace[] = [];
  const known = new Set<string>(US_STATES.map((state) => state.code));
  for (const line of lines) {
    for (const match of line.matchAll(WITH_COMMA)) {
      const code = match[2] as string;
      if (known.has(code)) shown.push({ city: match[1] as string, code });
    }
    for (const match of line.matchAll(WITH_STATE_NAME)) {
      const code = codeOf(match[2] as string);
      if (code !== null) shown.push({ city: match[1] as string, code });
    }
    for (const match of line.matchAll(WITHOUT_COMMA)) {
      const code = match[2] as string;
      if (!known.has(code) || (AMBIGUOUS_CODES.has(code) && match[3] === undefined)) continue;
      shown.push({ city: match[1] as string, code });
    }
    for (const piece of line.split(/\s+[|·•-]\s+/)) {
      const alone = piece.trim();
      if (known.has(alone) && !AMBIGUOUS_CODES.has(alone)) shown.push({ city: null, code: alone });
    }
    if (looksLikeName(line)) continue;
    for (const { code, byName } of STATE_NAME_PATTERNS) {
      if (byName.test(line)) shown.push({ city: null, code });
    }
  }
  return shown;
}

const LABEL_THEN_VALUE = (label: string) =>
  new RegExp(`^(?:current\\s+)?${label}\\s*:?\\s*(.*)$`, "iu");
const CITY_LABEL = LABEL_THEN_VALUE("(?:city|town)");
const STATE_LABEL = LABEL_THEN_VALUE("state");
const CITY_VALUE = new RegExp(`^${CITY_PATTERN}$`, "u");

/** What a label holds: the rest of its line, or the line after it when a table put the cell on its own. */
function valueUnder(lines: readonly string[], label: RegExp): string | null {
  for (const [i, line] of lines.entries()) {
    const match = label.exec(line.trim());
    if (match === null) continue;
    const value = (match[1] ?? "").trim() || (lines[i + 1] ?? "").trim();
    if (value !== "") return value;
  }
  return null;
}

/** A city and a state given under their own labels, as a table does, written as one place. */
function labeledPlace(lines: readonly string[]): string | null {
  const city = valueUnder(lines, CITY_LABEL);
  const state = valueUnder(lines, STATE_LABEL);
  if (city === null || state === null) return null;
  return CITY_VALUE.test(city) && isStateWord(state) ? `${city}, ${state}` : null;
}

/**
 * A place is absent only when the text shows a different one: another state, or another city in
 * the person's state. A text that shows only the person's state, or none, has not ruled the person out.
 */
function placeVerdict(main: string, fields: ProfileFields): Verdict["place"] {
  const city = (fields.city ?? "").trim();
  const state = (fields.state ?? "").trim();
  if (city === "" && state === "") return null;
  let found: boolean;
  if (city === "") {
    found = stateAnywhere(main, state);
  } else {
    const cityAt = new RegExp(`${WORD_BEFORE}${escapeRegExp(city)}${WORD_AFTER}`, "giu");
    const places = Array.from(main.matchAll(cityAt));
    found =
      state === ""
        ? places.length > 0
        : places.some((place) => stateAfter(main.slice(place.index + place[0].length), state));
  }
  if (found) return "found";
  const personState = state === "" ? null : (codeOf(state) ?? state.toUpperCase());
  const shown = placesShown(main.split("\n"));
  const elsewhere = shown.some((place) => {
    if (personState !== null && place.code !== personState) return true;
    if (city === "") return false;
    return place.city !== null && place.city.toLowerCase() !== city.toLowerCase();
  });
  return elsewhere ? "absent" : "not shown";
}

const BORN =
  /\b(?:born|b\.|birth year|dob|date of birth)\W{0,3}(?:in\s+)?(?:[A-Za-z]+\.?\s+)?(?:\d{1,2}[/-])?(?:\d{1,2},?\s+)?((?:19|20)\d{2})\b/i;
/** A page that says in words that it has no age has not hidden one from the parser. */
const AGE_ABSENT =
  /\bag(?:e|es|ed)\s*:?\s*(?:is\s+)?(?:not\s+(?:listed|shown|available|provided|known)|unknown|n\/a|withheld|unavailable|hidden)\b/gi;
/** Something that looks like an age or a birth year and that no pattern above could read. */
const AGE_LIKE = /\bag(?:e|es|ed)\b|\by\/?o\b|\byears?\s*old\b|\b(?:19\d{2}|200\d)\b/i;

function ageVerdict(
  text: string,
  year: number,
  born: number,
  birthYearShown: boolean,
): Verdict["age"] {
  const shown = agesInText(text);
  if (shown.length === 0)
    return !birthYearShown && AGE_LIKE.test(text.replace(AGE_ABSENT, " "))
      ? "unclear"
      : "not shown";
  const own = ageSpanInYear(born, year);
  const nearest = Math.min(...shown.map((span) => ageGap(span, own)));
  if (nearest === 0) return "fits";
  // A page goes stale by a few years, so only an age past the scorer's tolerance contradicts.
  return nearest <= WEAK_AGE_GAP ? "unclear" : "does not fit";
}

function birthYearOf(fields: ProfileFields): number | null {
  const year = /^(\d{4})/.exec((fields.birth_year ?? fields.date_of_birth ?? "").trim())?.[1];
  return year === undefined ? null : Number(year);
}

export function compareRecord(
  record: RecordText,
  fields: ProfileFields,
  year: number,
): { verdict: Verdict; lines: string[]; decision: "fits" | "contradicts" | "undecided" } {
  const { own: main, alias } = splitRecordLines(record.text);
  const mainText = main.join("\n");
  const name = personName(fields);
  const heading = record.heading.trim();
  // A heading such as "Background Report" reads as a name, and the page's own lines then say whom it is about.
  const headingIsName =
    looksLikeName(heading) &&
    (name === null ||
      nameMatch(heading, name) !== "none" ||
      !main.some((unit) => nameIn(unit, name)));
  const displayed = headingIsName
    ? heading
    : heading === "" && main[0] !== undefined && looksLikeName(main[0])
      ? main[0]
      : null;

  const verdict: Verdict = { name: null, place: null, birthYear: null, age: null };
  if (name) {
    if (displayed !== null ? nameIn(displayed, name) : main.some((unit) => nameIn(unit, name))) {
      verdict.name = "matches";
    } else if (alias.some((unit) => nameIn(unit, name))) {
      verdict.name = "matches as an alias";
    } else {
      const shortened = displayed !== null && nameMatch(displayed, name) === "partial";
      verdict.name = displayed !== null && !shortened ? "differs" : "not shown";
    }
  }
  const labeled = labeledPlace(main);
  verdict.place = placeVerdict(labeled === null ? mainText : `${mainText}\n${labeled}`, fields);

  const born = birthYearOf(fields);
  if (born !== null) {
    const shown = BORN.exec(mainText)?.[1];
    verdict.birthYear =
      shown === undefined ? "not shown" : Number(shown) === born ? "matches" : "differs";
    verdict.age = ageVerdict(mainText, year, born, shown !== undefined);
  }

  const lines: string[] = [];
  if (verdict.name) lines.push(`name: ${verdict.name}`);
  if (verdict.place) {
    lines.push(
      `place: ${verdict.place === "found" ? "found in current or past places" : verdict.place}`,
    );
  }
  if (verdict.birthYear) lines.push(`birth year: ${verdict.birthYear}`);
  if (verdict.age) lines.push(`age: ${verdict.age === "unclear" ? "not clear" : verdict.age}`);

  const contradicts =
    verdict.name === "differs" ||
    verdict.place === "absent" ||
    verdict.birthYear === "differs" ||
    verdict.age === "does not fit";
  if (contradicts) return { verdict, lines, decision: "contradicts" };
  const nameOk = verdict.name === null || verdict.name.startsWith("matches");
  const placeOk = verdict.place === null || verdict.place === "found";
  const birthOk =
    verdict.birthYear === null || verdict.birthYear === "matches" || verdict.age === "fits";
  return { verdict, lines, decision: nameOk && placeOk && birthOk ? "fits" : "undecided" };
}

export interface RecordJudgement {
  /** One line per identifier, never a value. */
  lines: string[];
  decision: "fits" | "contradicts" | "undecided";
  /** Which identifiers contradict the person, in words that carry no value. */
  clashes: string[];
}

/**
 * On a record page nothing more can be learned by looking further, so what the page leaves out
 * does not hold a record back when nothing it shows contradicts the person. A page that confirms
 * none of the identifiers that were compared is left to the model.
 */
export function judgeRecord(
  record: RecordText,
  fields: ProfileFields,
  year: number,
  onRecordPage: boolean,
): RecordJudgement {
  const { verdict, lines, decision } = compareRecord(record, fields, year);
  const clashes = [
    verdict.name === "differs" ? "name differs" : null,
    verdict.place === "absent" ? "place differs" : null,
    verdict.birthYear === "differs" ? "birth year differs" : null,
    verdict.age === "does not fit" ? "age does not fit" : null,
  ].filter((clash): clash is string => clash !== null);
  if (decision === "contradicts") return { lines, decision, clashes };
  const nameFits = (verdict.name ?? "matches").startsWith("matches");
  const compared = verdict.place !== null || verdict.birthYear !== null;
  const confirmed =
    verdict.place === "found" || verdict.birthYear === "matches" || verdict.age === "fits";
  // An age the page shows in a form the parser cannot read is not an absent age, so the model decides.
  const readable = verdict.age !== "unclear";
  const fits =
    decision === "fits" || (onRecordPage && readable && nameFits && (confirmed || !compared));
  return { lines, decision: fits ? "fits" : "undecided", clashes };
}

export const VERDICT_ENDINGS = {
  fits: "fits: include it in your report",
  contradicts: "contradicts: leave it out",
  undecided: "not decided: call check_record without a ref on the results page",
} as const;

/** The answer for the model: one verdict per identifier, never a value. */
export function describeRecordCheck(
  record: RecordText,
  fields: ProfileFields,
  year: number,
  onRecordPage: boolean,
): string {
  const { lines, decision } = judgeRecord(record, fields, year, onRecordPage);
  return [...(lines.length > 0 ? lines : ["nothing to compare"]), VERDICT_ENDINGS[decision]].join(
    "\n",
  );
}

/**
 * Whether a card or page names anybody: a heading, a line that reads as a name, or the person.
 * A footer link's card names nobody, and what it says is no verdict on a record.
 */
export function namesSomebody(record: RecordText, fields: ProfileFields): boolean {
  if (record.heading.trim() !== "") return true;
  const { own: main } = splitRecordLines(record.text);
  const name = personName(fields);
  return main.some((unit) => looksLikeName(unit) || (name !== null && nameIn(unit, name)));
}

/** A link on a results page with the card around it, as the page script reads it. */
export interface CardText extends RecordText {
  ref: string;
  href: string;
  /** What the link itself says, which names the record when its card has no heading. */
  linkText: string;
}

/** Link words that offer a page and name nobody, however they are capitalised. */
const GENERIC_LINK =
  /^(?:view|open|see|show|read|get|full|more|search|next|previous|back|click|details?|report|profile)\b/i;

/** The path shape a site gives its records: a section and an id, which a second record shares. */
function kindOfAddress(href: string): { origin: string; count: number; first: string } | null {
  try {
    const url = new URL(href);
    const segments = url.pathname.split("/").filter(Boolean);
    return { origin: url.origin, count: segments.length, first: segments[0] ?? "" };
  } catch {
    return null;
  }
}

/** A link text that is no record's: nothing, a pager control, or only a place. */
function isNoRecordLink(text: string): boolean {
  const link = text.trim();
  return link === "" || readsAsPagination(link) || isPlaceLine(link);
}

function pathOfAddress(href: string): string {
  try {
    return new URL(href).pathname;
  } catch {
    return href;
  }
}

/**
 * The cards of a results page that are records, once for each address, since a card often links
 * its record twice. A card is a record when it has a heading, when its link text or its text names
 * the person, when its link reads as a name, or when its address has the shape of other record
 * links on the page. A site that words every link "Open full report" is told apart by the last.
 */
export function recordCards(
  found: readonly CardText[],
  fields: ProfileFields | null = null,
): CardText[] {
  const name = fields === null ? null : personName(fields);
  const kinds = found.map((card) => ({ card, kind: kindOfAddress(card.href) }));
  const sharesKind = (card: CardText, kind: ReturnType<typeof kindOfAddress>) =>
    kind !== null &&
    !isNoRecordLink(card.linkText) &&
    kind.count >= 2 &&
    kinds.some(
      (other) =>
        other.card !== card &&
        other.kind !== null &&
        other.kind.origin === kind.origin &&
        other.kind.count === kind.count &&
        other.kind.first === kind.first &&
        pathOfAddress(other.card.href) !== pathOfAddress(card.href),
    );
  const byAddress = new Map<string, CardText>();
  for (const { card, kind } of kinds) {
    const link = card.linkText.trim();
    const namesPerson =
      name !== null && (nameMatch(link, name) !== "none" || nameMatch(card.text, name) !== "none");
    const readsAsName = looksLikeName(link) && !GENERIC_LINK.test(link);
    if (card.heading.trim() === "" && !namesPerson && !readsAsName && !sharesKind(card, kind)) {
      continue;
    }
    const address = card.href.split("#")[0] ?? card.href;
    const kept = byAddress.get(address);
    if (kept === undefined || (kept.heading.trim() === "" && card.heading.trim() !== "")) {
      byAddress.set(address, card);
    }
  }
  return Array.from(byAddress.values());
}

/**
 * Finds the card around a link: the article, list item or row it is in, and for a page that uses
 * none of them, the widest box that holds this link and no other link to a record of the same kind.
 */
const FIND_CARD = `
  const clean = (text) => (text || "").replace(/\\s+/g, " ").trim();
  const kindOf = (a) => {
    try {
      const url = new URL(a.href);
      const segments = url.pathname.split("/").filter(Boolean);
      return { origin: url.origin, path: url.pathname, search: url.search, count: segments.length, first: segments[0] || "" };
    } catch (e) { return null; }
  };
  const another = (a, b) => {
    if (!a || !b || a.origin !== b.origin) return false;
    if (a.path === b.path) return a.search !== b.search;
    return a.count >= 2 && a.count === b.count && a.first === b.first;
  };
  const cardOf = (el, anchors, kinds) => {
    const marked = el.closest("article, li, tr");
    if (marked) return marked;
    const mine = kinds.get(el);
    const others = anchors.filter((a) => a !== el && another(mine, kinds.get(a)));
    let root = el;
    while (root.parentElement && root.parentElement !== document.body && !others.some((a) => root.parentElement.contains(a))) {
      root = root.parentElement;
    }
    return root;
  };
  const anchorsOfPage = () => {
    const anchors = Array.from(document.querySelectorAll("a[href]"));
    return { anchors, kinds: new Map(anchors.map((a) => [a, kindOf(a)])) };
  };
  const HEADINGS = "h1, h2, h3, h4, h5, h6";
`;

/**
 * The text of a record page without the site's header, navigation, footer and sidebars, which hold
 * its own contact details and other people's. It breaks lines at block elements, as innerText does.
 */
const PAGE_OWN_TEXT = `(root) => {
  const SKIPPED = "header, nav, footer, aside, [role=banner], [role=navigation], [role=contentinfo], [role=complementary], script, style, noscript, template";
  const parts = [];
  const walk = (node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parts.push(node.textContent.replace(/\\s+/g, " "));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE || (node !== root && node.matches(SKIPPED))) return;
    const style = getComputedStyle(node);
    if (style.display === "none" || style.visibility === "hidden") return;
    const block = !style.display.startsWith("inline") || node.tagName === "BR";
    const cell = style.display === "table-cell";
    if (block) parts.push("\\n");
    for (const child of node.childNodes) walk(child);
    parts.push(cell ? "\\t" : block ? "\\n" : "");
  };
  walk(root);
  return parts.join("");
}`;

/** Reads a card or a record page in the page, as text, for {@link describeRecordCheck}. */
export const READ_RECORD_TEXT = `(el, mode) => {
  ${FIND_CARD}
  const ownText = ${PAGE_OWN_TEXT};
  let root;
  if (mode === "page") {
    root = document.querySelector("main") || document.body;
  } else {
    const { anchors, kinds } = anchorsOfPage();
    root = cardOf(el, anchors, kinds);
  }
  const heading = Array.from(root.querySelectorAll(HEADINGS)).find(
    (h) => mode !== "page" || !h.closest("aside, nav, header, footer"),
  );
  return {
    href: mode === "page" ? location.href : el.href,
    heading: heading ? clean(heading.textContent) : "",
    text: (mode === "page" ? ownText(root) : root.innerText || "").slice(0, 6000),
  };
}`;

/**
 * Reads every link outside the header, navigation and footer with the card around it, once for
 * each card. The ref is the one the latest snapshot gave the link, so a card is named as the model sees it.
 */
export const READ_RECORD_CARDS = `(() => {
  ${FIND_CARD}
  const { anchors, kinds } = anchorsOfPage();
  const here = location.href.split("#")[0];
  const cards = new Map();
  for (const a of anchors) {
    if (a.closest("header, nav, footer")) continue;
    if (!/^https?:$/.test(a.protocol) || a.href.split("#")[0] === here) continue;
    const ref = a.getAttribute("data-kr-ref");
    if (!ref) continue;
    const root = cardOf(a, anchors, kinds);
    const heading = root.querySelector(HEADINGS);
    const inHeading = Boolean(heading && heading.contains(a));
    const kept = cards.get(root);
    if (kept && (kept.inHeading || !inHeading)) continue;
    cards.set(root, { ref, href: a.href, linkText: clean(a.textContent), inHeading, root, heading });
  }
  return Array.from(cards.values()).map((card) => ({
    ref: card.ref,
    href: card.href,
    linkText: card.linkText,
    heading: card.heading ? clean(card.heading.textContent) : "",
    text: (card.root.innerText || "").slice(0, 6000),
  }));
})()`;
