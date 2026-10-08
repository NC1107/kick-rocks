import { type ProfileFields, US_STATES } from "@kickrocks/shared";

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
  age: "fits" | "does not fit" | "not shown" | null;
};

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
const ALIAS_LABEL =
  /\b(?:also known as|a\.?k\.?a\.?|aliases|alias|formerly|previously known as|maiden name|other names|also called|nee)\b\s*:?/i;
const RELATIVES_LABEL =
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

/** The first and last name in order or as "Last, First", with up to two middle names or initials between. */
function nameIn(unit: string, name: { first: string; last: string }): boolean {
  const words = nameTokens(unit);
  const apart = (from: string, to: string) =>
    words.some(
      (word, i) => word === from && words.slice(i + 1, i + 4).some((later) => later === to),
    );
  return apart(name.first, name.last) || apart(name.last, name.first);
}

function looksLikeName(text: string): boolean {
  const words = text.split(/[\s,]+/).filter(Boolean);
  if (words.length < 2 || words.length > 6 || text.length > 60) return false;
  if (/,\s*[A-Z]{2}$/.test(text) || US_STATES.some((state) => state.name === text)) return false;
  return words.every((word) => /^\p{Lu}[\p{L}.'-]*$/u.test(word));
}

interface Parts {
  main: string[];
  alias: string[];
}

/** Splits the text into lines of the page's own details and of its aliases, leaving relatives out. */
function partsOf(text: string): Parts {
  const parts: Parts = { main: [], alias: [] };
  for (const raw of text.split(/[\n\t]+/)) {
    let unit = raw.trim();
    if (unit === "") continue;
    const relatives = RELATIVES_LABEL.exec(unit);
    if (relatives) unit = unit.slice(0, relatives.index).trim();
    const alias = ALIAS_LABEL.exec(unit);
    if (alias) {
      const before = unit.slice(0, alias.index).trim();
      if (before !== "") parts.main.push(before);
      parts.alias.push(unit.slice(alias.index + alias[0].length));
      continue;
    }
    if (unit !== "") parts.main.push(unit);
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
  const placeShown =
    /,\s*[A-Z]{2}(?![A-Za-z])/.test(main) || US_STATES.some((s) => stateAnywhere(main, s.name));
  return placeShown ? "absent" : "not shown";
}

const BORN =
  /\b(?:born|b\.|birth year|dob|date of birth)\W{0,3}(?:in\s+)?(?:[A-Za-z]+\.?\s+)?(?:\d{1,2}[/-])?(?:\d{1,2},?\s+)?((?:19|20)\d{2})\b/i;
const AGE = /\bage[d]?\s*:?\s*(\d{1,3})\b|\b(\d{1,3})\s*(?:years?\s*old|yrs?\b)/i;

function birthYearOf(fields: ProfileFields): number | null {
  const year = /^(\d{4})/.exec((fields.birth_year ?? fields.date_of_birth ?? "").trim())?.[1];
  return year === undefined ? null : Number(year);
}

export function compareRecord(
  record: RecordText,
  fields: ProfileFields,
  year: number,
): { verdict: Verdict; lines: string[]; decision: "fits" | "contradicts" | "undecided" } {
  const { main, alias } = partsOf(record.text);
  const mainText = main.join("\n");
  const name = personName(fields);
  const heading = record.heading.trim();
  const displayed = looksLikeName(heading)
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
      verdict.name = displayed !== null ? "differs" : "not shown";
    }
  }
  verdict.place = placeVerdict(mainText, fields);

  const born = birthYearOf(fields);
  if (born !== null) {
    const shown = BORN.exec(mainText)?.[1];
    verdict.birthYear =
      shown === undefined ? "not shown" : Number(shown) === born ? "matches" : "differs";
    const ageMatch = AGE.exec(mainText);
    const age = Number(ageMatch?.[1] ?? ageMatch?.[2]);
    if (ageMatch === null) verdict.age = "not shown";
    else verdict.age = age === year - born || age === year - born - 1 ? "fits" : "does not fit";
  }

  const lines: string[] = [];
  if (verdict.name) lines.push(`name: ${verdict.name}`);
  if (verdict.place) {
    lines.push(
      `place: ${verdict.place === "found" ? "found in current or past places" : verdict.place}`,
    );
  }
  if (verdict.birthYear) lines.push(`birth year: ${verdict.birthYear}`);
  if (verdict.age) lines.push(`age: ${verdict.age}`);

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
 * does not hold a record back when nothing it does show contradicts the person.
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
  const fits =
    decision === "fits" || (onRecordPage && (verdict.name ?? "matches").startsWith("matches"));
  return { lines, decision: fits ? "fits" : "undecided", clashes };
}

export const VERDICT_ENDINGS = {
  fits: "fits: report it",
  contradicts: "contradicts: leave it out",
  undecided: "not decided: open the record page",
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
  const { main } = partsOf(record.text);
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

/**
 * The cards of a results page that are records: those with a heading or a link that reads as a
 * name, once for each address, since a card often links its record twice.
 */
export function recordCards(found: readonly CardText[]): CardText[] {
  const byAddress = new Map<string, CardText>();
  for (const card of found) {
    if (card.heading.trim() === "" && !looksLikeName(card.linkText)) continue;
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

/** Reads a card or a record page in the page, as text, for {@link describeRecordCheck}. */
export const READ_RECORD_TEXT = `(el, mode) => {
  ${FIND_CARD}
  let root;
  if (mode === "page") {
    root = document.querySelector("main") || document.body;
  } else {
    const { anchors, kinds } = anchorsOfPage();
    root = cardOf(el, anchors, kinds);
  }
  const heading = root.querySelector(HEADINGS);
  return {
    href: mode === "page" ? location.href : el.href,
    heading: heading ? clean(heading.textContent) : "",
    text: (root.innerText || "").slice(0, 6000),
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
