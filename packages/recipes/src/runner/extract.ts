import { Candidate, type CandidateField, normalizeRecordUrl } from "@kickrocks/shared";
import type { Locator } from "playwright";
import { READ_FIELDS } from "./page-scripts.js";
import { webUrlFrom } from "./text.js";

/** The most candidates one scan reports, which keeps a runaway page out of a task result. */
export const MAX_CANDIDATES = 100;

type Rules = Record<string, CandidateField>;
type Row = Record<string, string[]>;

/** Reads each rule inside every element the locator matches. */
async function readRows(items: Locator, rules: Rules): Promise<Row[]> {
  return items.evaluateAll(READ_FIELDS, rules);
}

/** The first whole number in the text, so "John Smith, 45 (born 1980)" reads as 45. */
export function ageFrom(values: string[] | undefined): number | undefined {
  const digits = /\d+/.exec(values?.[0] ?? "");
  if (!digits) return undefined;
  const years = Number.parseInt(digits[0], 10);
  return years >= 0 && years <= 130 ? years : undefined;
}

function list(values: string[] | undefined): string[] | undefined {
  return values && values.length > 0 ? values : undefined;
}

interface CandidateFields {
  recordUrl: CandidateField;
  name: CandidateField;
  age?: CandidateField | undefined;
  locations?: CandidateField | undefined;
  relatives?: CandidateField | undefined;
  phones?: CandidateField | undefined;
  emails?: CandidateField | undefined;
}

/**
 * Turns result cards into candidates. A card without a usable record link or a name is not a
 * candidate, and two cards that name the same record count once.
 */
export async function extractCandidates(
  items: Locator,
  fields: CandidateFields,
  pageUrl: string,
): Promise<Candidate[]> {
  const rules: Rules = {};
  for (const [key, rule] of Object.entries(fields)) {
    if (rule === undefined) continue;
    rules[key] =
      key === "recordUrl" || key === "name" || key === "age" ? { ...rule, all: false } : rule;
  }
  const rows = await readRows(items, rules);
  const seen = new Set<string>();
  const candidates: Candidate[] = [];
  for (const row of rows) {
    const recordUrl = webUrlFrom(row.recordUrl?.[0], pageUrl);
    const name = row.name?.[0];
    if (recordUrl === null || !name) continue;
    const key = normalizeRecordUrl(recordUrl);
    if (key === null || seen.has(key)) continue;
    const years = ageFrom(row.age);
    const parsed = Candidate.safeParse({
      recordUrl,
      name,
      ...(years === undefined ? {} : { age: years }),
      locations: row.locations ?? [],
      ...(list(row.relatives) ? { relatives: list(row.relatives) } : {}),
      ...(list(row.phones) ? { phones: list(row.phones) } : {}),
      ...(list(row.emails) ? { emails: list(row.emails) } : {}),
    });
    if (!parsed.success) continue;
    seen.add(key);
    candidates.push(parsed.data);
    if (candidates.length >= MAX_CANDIDATES) break;
  }
  return candidates;
}

/** The index of the first card whose link names the same record, compared as the scan did. */
export async function findRecordIndex(
  items: Locator,
  link: CandidateField,
  wanted: string,
  pageUrl: string,
): Promise<number> {
  const rows = await readRows(items, { link: { ...link, all: false } });
  return rows.findIndex((row) => {
    const url = webUrlFrom(row.link?.[0], pageUrl);
    return url !== null && normalizeRecordUrl(url) === wanted;
  });
}
