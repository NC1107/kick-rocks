import { US_STATES } from "@kickrocks/shared";
import { looksLikeName, RELATIVES_LABEL } from "./record-check.js";

/** What the worker read of one record: the heading and link text it was named by, and the page or card text. */
export interface RecordReading {
  heading: string;
  linkText: string;
  text: string;
}

export interface CandidateDetails {
  name: string;
  age?: number;
  locations: string[];
  relatives: string[];
  phones: string[];
  emails: string[];
}

const STATE_CODES = new Set<string>(US_STATES.map((state) => state.code));
const AGE = /\bage[d]?\s*:?\s*(\d{1,3})\b/i;
const PLACE =
  /(?<![\p{L}\p{N}])(\p{Lu}[\p{L}.'-]*(?:[ ]\p{Lu}[\p{L}.'-]*){0,2}),\s*([A-Z]{2})(?![\p{L}\p{N}])/gu;
const PHONE = /(?<![\d])(?:\+?1[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}(?![\d])/g;
const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

function unique(items: readonly string[]): string[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = item.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function asName(entry: string): string | null {
  const cleaned = entry
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bage[d]?\s*:?\s*\d{1,3}\b/gi, " ")
    .replace(/[.\s]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return looksLikeName(cleaned) ? cleaned : null;
}

function namesIn(segment: string): string[] {
  return segment
    .split(/[,;|·]|\band\b/i)
    .map(asName)
    .filter((name): name is string => name !== null);
}

/**
 * Splits the text into the page's own lines and the names on a relatives or associates line. A
 * list of relatives that goes on over the next lines is followed for as long as the lines read as names.
 */
function linesOf(text: string): { own: string[]; relatives: string[] } {
  const own: string[] = [];
  const relatives: string[] = [];
  let listing = false;
  for (const raw of text.split(/[\n\t]+/)) {
    const line = raw.trim();
    if (line === "") continue;
    const label = RELATIVES_LABEL.exec(line);
    if (label) {
      const before = line.slice(0, label.index).trim();
      if (before !== "") own.push(before);
      const names = namesIn(line.slice(label.index + label[0].length));
      relatives.push(...names);
      listing = true;
      continue;
    }
    if (listing) {
      const names = namesIn(line);
      if (names.length > 0 && !line.includes(":")) {
        relatives.push(...names);
        continue;
      }
      listing = false;
    }
    own.push(line);
  }
  return { own, relatives };
}

function nameOf(reading: RecordReading, own: readonly string[]): string {
  const { heading, linkText } = reading;
  const named = [heading, linkText].map((text) => text.trim()).find((text) => looksLikeName(text));
  if (named !== undefined) return named;
  const leading = own.find((line) => looksLikeName(line));
  return leading || heading.trim() || linkText.trim() || "";
}

/**
 * The details of a candidate, taken from the real text of the card or record page, so what the
 * server stores is what the site showed and not the model's copy of it.
 */
export function detailsOf(reading: RecordReading): CandidateDetails {
  const { own, relatives } = linesOf(reading.text);
  const ownText = own.join("\n");
  const age = Number(AGE.exec(ownText)?.[1]);
  const places = Array.from(ownText.matchAll(PLACE))
    .filter((place) => STATE_CODES.has(place[2] as string))
    .map((place) => `${place[1]}, ${place[2]}`);
  return {
    name: nameOf(reading, own),
    ...(age > 0 && age < 130 ? { age } : {}),
    locations: unique(places),
    relatives: unique(relatives),
    phones: unique(reading.text.match(PHONE)?.map((phone) => phone.trim()) ?? []),
    emails: unique(reading.text.match(EMAIL) ?? []),
  };
}
