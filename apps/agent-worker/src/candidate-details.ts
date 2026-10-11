import { US_STATES } from "@kickrocks/shared";
import { looksLikeName, splitRecordLines } from "./record-check.js";

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

/** The people one line of a list names. The city that follows a name after a dash or a comma is not another person. */
function namesIn(segment: string): string[] {
  const chunks = segment.split(/[,;|·]|\band\b/i).map((chunk) => chunk.trim());
  return chunks
    .map((chunk, i) => {
      const [head = "", ...rest] = chunk.split(/\s+[-\u2013\u2014]\s+/);
      const isCity = rest.length === 0 && STATE_CODES.has(chunks[i + 1] ?? "");
      return isCity ? null : asName(head);
    })
    .filter((name): name is string => name !== null);
}

function isOwnDomain(email: string, siteHosts: readonly string[]): boolean {
  const host = email.split("@")[1]?.toLowerCase() ?? "";
  return siteHosts.some((site) => host === site || host.endsWith(`.${site}`));
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
export function detailsOf(
  reading: RecordReading,
  siteHosts: readonly string[] = [],
): CandidateDetails {
  const { own, relatives } = splitRecordLines(reading.text);
  const ownText = own.join("\n");
  const age = Number(AGE.exec(ownText)?.[1]);
  const places = Array.from(ownText.matchAll(PLACE))
    .filter((place) => STATE_CODES.has(place[2] as string))
    .map((place) => `${place[1]}, ${place[2]}`);
  return {
    name: nameOf(reading, own),
    ...(age > 0 && age < 130 ? { age } : {}),
    locations: unique(places),
    relatives: unique(relatives.flatMap(namesIn)),
    phones: unique(ownText.match(PHONE)?.map((phone) => phone.trim()) ?? []),
    emails: unique((ownText.match(EMAIL) ?? []).filter((email) => !isOwnDomain(email, siteHosts))),
  };
}
