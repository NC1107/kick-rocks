import { z } from "zod";
import { US_STATES } from "./geography.js";

export const MatchBand = z.enum(["likely", "maybe", "unlikely"]);
export type MatchBand = z.infer<typeof MatchBand>;

export const ReasonWeight = z.enum(["strong", "weak", "neutral", "weak_against", "contradicts"]);
export type ReasonWeight = z.infer<typeof ReasonWeight>;

export const AgeSpan = z
  .object({ low: z.number().int().nonnegative(), high: z.number().int().nonnegative() })
  .refine((span) => span.low <= span.high);
export type AgeSpan = z.infer<typeof AgeSpan>;

export const MatchReason = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("age"),
    weight: ReasonWeight,
    candidate: AgeSpan,
    profile: AgeSpan,
  }),
  z.object({
    kind: z.literal("place"),
    weight: ReasonWeight,
    city: z.string().optional(),
    state: z.string().optional(),
    past: z.boolean().optional(),
  }),
  z.object({
    kind: z.literal("name"),
    weight: ReasonWeight,
    via: z.enum(["exact", "variant", "middle", "different"]),
  }),
  z.object({ kind: z.literal("phone"), weight: ReasonWeight }),
  z.object({ kind: z.literal("email"), weight: ReasonWeight }),
]);
export type MatchReason = z.infer<typeof MatchReason>;

/** How likely a scan candidate is the profile's person. It informs the person's decision and never makes it. */
export const MatchAssessment = z.object({
  band: MatchBand,
  score: z.number().int().min(0).max(100),
  reasons: z.array(MatchReason),
});
export type MatchAssessment = z.infer<typeof MatchAssessment>;

export interface ScoreCandidate {
  name: string;
  age?: number | undefined;
  ageRange?: AgeSpan | undefined;
  birthYear?: number | undefined;
  locations?: readonly string[] | undefined;
  relatives?: readonly string[] | undefined;
  phones?: readonly string[] | undefined;
  emails?: readonly string[] | undefined;
}

export interface ScoreProfile {
  /** The primary name first, then aliases and past names. */
  names: readonly { first: string; middle?: string | undefined; last: string }[];
  /** A date of birth as YYYY-MM-DD, or only a year as YYYY. */
  birth?: string | null | undefined;
  addresses?: readonly { city: string; state: string; current: boolean }[] | undefined;
  /** States the profile is tied to without a street address. */
  states?: readonly string[] | undefined;
  phones?: readonly string[] | undefined;
  emails?: readonly string[] | undefined;
}

const BASE_SCORE = 50;
const LIKELY_FROM = 70;
const UNLIKELY_UNTIL = 30;

const POINTS: Record<ReasonWeight, number> = {
  strong: 15,
  weak: 5,
  neutral: 0,
  weak_against: -8,
  contradicts: -35,
};
const IDENTIFIER_POINTS = 25;
const FAR_CONTRADICTION_POINTS = -55;

/** A page goes stale by a year or two, which is why two years off still counts as the same age. */
export const STRONG_AGE_GAP = 2;
export const WEAK_AGE_GAP = 5;
const FAR_AGE_GAP = 10;
/** A range wider than this says too little to confirm anyone. */
const NARROW_RANGE = 5;

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter((word) => word !== "" && !NAME_SUFFIXES.has(word));
}

function shownTokens(name: string): string[] {
  const flipped = name.includes(",") ? name.split(",").reverse().join(" ") : name;
  return words(flipped);
}

const startsWith = (tokens: readonly string[], head: readonly string[]) =>
  head.every((token, index) => tokens[index] === token);

/** Reads what sits between the profile's own first and last name as the candidate's middle name. */
function readAgainst(
  tokens: readonly string[],
  own: { first: string; last: string },
): { middle: string } | null {
  const first = words(own.first);
  const last = words(own.last);
  if (first.length === 0 || last.length === 0 || tokens.length < first.length + last.length) {
    return null;
  }
  if (!startsWith(tokens, first) || !startsWith(tokens.slice(-last.length), last)) return null;
  return { middle: tokens.slice(first.length, tokens.length - last.length).join(" ") };
}

function nameReason(candidate: ScoreCandidate, profile: ScoreProfile): MatchReason | null {
  const tokens = shownTokens(candidate.name);
  if (tokens.length < 2 || profile.names.length === 0) return null;

  const matching = profile.names.flatMap((name, index) => {
    const read = readAgainst(tokens, name);
    return read ? [{ shown: read.middle, own: words(name.middle ?? "").join(" "), index }] : [];
  });
  if (matching.length === 0) {
    // A different first name over the same last name may be a nickname, so only a last name that
    // fits no name of the person is held against the record.
    const sharesLast = profile.names.some((name) => {
      const last = words(name.last);
      return last.length > 0 && startsWith(tokens.slice(-last.length), last);
    });
    return sharesLast ? null : { kind: "name", weight: "weak_against", via: "different" };
  }

  const middleAgrees = (entry: (typeof matching)[number]) =>
    entry.own === "" || entry.shown === "" || entry.own[0] === entry.shown[0];
  const agreeing = matching.find(middleAgrees);
  if (!agreeing) return { kind: "name", weight: "weak_against", via: "middle" };
  return { kind: "name", weight: "strong", via: agreeing.index === 0 ? "exact" : "variant" };
}

function profileAge(birth: string, today: string): AgeSpan | null {
  const year = Number(birth.slice(0, 4));
  if (!Number.isInteger(year) || birth.length < 4) return null;
  const todayYear = Number(today.slice(0, 4));
  if (/^\d{4}-\d{2}-\d{2}$/.test(birth)) {
    const hadBirthday = today.slice(5) >= birth.slice(5);
    const age = todayYear - year - (hadBirthday ? 0 : 1);
    return { low: age, high: age };
  }
  return ageSpanInYear(year, todayYear);
}

function candidateAge(candidate: ScoreCandidate, today: string): AgeSpan | null {
  if (candidate.ageRange) return candidate.ageRange;
  if (candidate.age !== undefined) return { low: candidate.age, high: candidate.age };
  if (candidate.birthYear !== undefined) {
    return ageSpanInYear(candidate.birthYear, Number(today.slice(0, 4)));
  }
  return null;
}

/** Whole years between two age spans, zero when they touch. */
export function ageGap(a: AgeSpan, b: AgeSpan): number {
  if (a.high < b.low) return b.low - a.high;
  if (b.high < a.low) return a.low - b.high;
  return 0;
}

function ageReason(
  candidate: ScoreCandidate,
  profile: ScoreProfile,
  today: string,
): MatchReason | null {
  const shown = candidateAge(candidate, today);
  const own = profile.birth ? profileAge(profile.birth, today) : null;
  if (shown === null || own === null) return null;
  const gap = ageGap(shown, own);
  const narrow = shown.high - shown.low <= NARROW_RANGE;
  let weight: ReasonWeight = "strong";
  if (gap > WEAK_AGE_GAP) weight = "contradicts";
  else if (gap > STRONG_AGE_GAP || !narrow) weight = "weak";
  return { kind: "age", weight, candidate: shown, profile: own };
}

interface Place {
  city: string;
  state: string;
}

const STATE_CODE_BY_NAME = new Map(
  US_STATES.map((state) => [state.name.toLowerCase(), state.code]),
);
const STATE_CODES = new Set<string>(US_STATES.map((state) => state.code));
const PLACE_TEXT = /^(.+?),\s*([A-Za-z][A-Za-z .]*?)\.?(?:\s+\d{5}(?:-\d{4})?)?$/;

function placeOf(text: string): Place | null {
  const found = PLACE_TEXT.exec(text.trim());
  if (!found) return null;
  const region = (found[2] as string).trim();
  const code =
    region.length === 2 ? region.toUpperCase() : STATE_CODE_BY_NAME.get(region.toLowerCase());
  if (code === undefined || !STATE_CODES.has(code)) return null;
  return { city: (found[1] as string).trim().toLowerCase(), state: code };
}

function placeReason(candidate: ScoreCandidate, profile: ScoreProfile): MatchReason | null {
  const shown = (candidate.locations ?? [])
    .map(placeOf)
    .filter((place): place is Place => place !== null);
  const addresses = profile.addresses ?? [];
  const states = new Set([
    ...addresses.map((address) => address.state.toUpperCase()),
    ...(profile.states ?? []).map((state) => state.toUpperCase()),
  ]);
  if (shown.length === 0 || states.size === 0) return null;

  const sameCity = addresses.filter((address) =>
    shown.some(
      (place) =>
        place.state === address.state.toUpperCase() &&
        place.city === address.city.trim().toLowerCase(),
    ),
  );
  const best = sameCity.find((address) => address.current) ?? sameCity[0];
  if (best) {
    return {
      kind: "place",
      weight: "strong",
      city: best.city,
      state: best.state.toUpperCase(),
      past: !best.current,
    };
  }
  const state = shown.find((place) => states.has(place.state))?.state;
  if (state !== undefined) return { kind: "place", weight: "weak", state };
  return { kind: "place", weight: "neutral" };
}

function lastTenDigits(phone: string): string {
  return phone.replace(/\D/g, "").slice(-10);
}

function overlaps(
  shown: readonly string[] | undefined,
  known: readonly string[] | undefined,
  normalize: (value: string) => string,
): boolean {
  const wanted = new Set((known ?? []).map(normalize).filter((value) => value !== ""));
  return (shown ?? []).some((value) => wanted.has(normalize(value)));
}

function pointsOf(reason: MatchReason): number {
  if (reason.kind === "phone" || reason.kind === "email") return IDENTIFIER_POINTS;
  if (reason.kind === "age" && reason.weight === "contradicts") {
    const gap = ageGap(reason.candidate, reason.profile);
    return gap > FAR_AGE_GAP ? FAR_CONTRADICTION_POINTS : POINTS.contradicts;
  }
  return POINTS[reason.weight];
}

/**
 * A scan searches by name and place, so those two agreeing proves nothing. Only a strong age, a
 * phone or an email can carry a record to likely, and never one whose age or name is against it.
 */
function canBeLikely(reasons: readonly MatchReason[]): boolean {
  if (reasons.some((reason) => reason.weight === "contradicts")) return false;
  if (reasons.some((reason) => reason.kind === "name" && reason.via === "different")) return false;
  return reasons.some(
    (reason) =>
      reason.kind === "phone" ||
      reason.kind === "email" ||
      (reason.kind === "age" && reason.weight === "strong"),
  );
}

/**
 * Scores how well a scan candidate fits a profile. A field either side lacks is left out rather
 * than counted against the candidate, and nothing here decides: the person still confirms or
 * rejects every record.
 */
export function scoreCandidate(
  candidate: ScoreCandidate,
  profile: ScoreProfile,
  today: string,
): MatchAssessment {
  const reasons: MatchReason[] = [];
  for (const reason of [
    nameReason(candidate, profile),
    ageReason(candidate, profile, today),
    placeReason(candidate, profile),
  ]) {
    if (reason) reasons.push(reason);
  }
  if (overlaps(candidate.phones, profile.phones, lastTenDigits)) {
    reasons.push({ kind: "phone", weight: "strong" });
  }
  if (overlaps(candidate.emails, profile.emails, (email) => email.trim().toLowerCase())) {
    reasons.push({ kind: "email", weight: "strong" });
  }

  const total = reasons.reduce((sum, reason) => sum + pointsOf(reason), BASE_SCORE);
  const score = Math.max(0, Math.min(100, total));
  let band: MatchBand = "maybe";
  if (score <= UNLIKELY_UNTIL) band = "unlikely";
  else if (score >= LIKELY_FROM && canBeLikely(reasons)) band = "likely";
  return { band, score, reasons };
}

const AGE_RANGE = /\b(\d{1,3})\s*(?:-|\u2013|\u2014|to)\s*(\d{1,3})\b/;
const AGE_DECADE = /\b([1-9])0['\u2019]?s\b/i;
const AGE_SINGLE = /\b(\d{1,3})\b/;
const MAX_AGE = 120;
const BIRTH_YEAR =
  /\b(?:born|b\.|birth year)\W{0,3}(?:in\s+)?(?:[A-Za-z]+\.?\s+)?(?:\d{1,2},?\s+)?((?:19|20)\d{2})\b/i;

/** The ages a scan card states, such as "47", "Ages 42-47" or "In their 40s". */
export function parseAgeText(text: string): AgeSpan | null {
  const range = AGE_RANGE.exec(text);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    if (low <= high && high <= MAX_AGE) return { low, high };
  }
  const decade = AGE_DECADE.exec(text);
  if (decade) {
    const low = Number(decade[1]) * 10;
    return { low, high: low + 9 };
  }
  const single = AGE_SINGLE.exec(text);
  const age = single ? Number(single[1]) : Number.NaN;
  return age > 0 && age <= MAX_AGE ? { low: age, high: age } : null;
}

/** The year of birth a card states, such as "born 1980". */
export function parseBirthYear(text: string): number | null {
  const year = BIRTH_YEAR.exec(text)?.[1];
  return year === undefined ? null : Number(year);
}

/** The age a stated span gives as a candidate field: one age, or a range when it spans several. */
export function ageFieldsOf(span: AgeSpan | null): { age?: number; ageRange?: AgeSpan } {
  if (span === null) return {};
  return span.low === span.high ? { age: span.low } : { ageRange: span };
}

const STATED_AGE_WORD =
  /\bag(?:e|es|ed)\s*:?\s*(\d{1,3})(?:\s*(?:-|\u2013|\u2014|to)\s*(\d{1,3}))?\b/gi;
const STATED_AGE_YEARS = /\b(\d{1,3})\s*(?:years?\s*old|yrs?\b|y\/?o\b)/gi;
const STATED_AGE_PARENS = /\((\d{2,3})\)(?!\s*\d{3}[\s.-]\d{4})/g;
const STATED_AGE_DECADE = /\b([1-9])0['\u2019]?s\b/gi;
const STATED_AGE_AFTER_NAME = /^\p{Lu}[\p{L}.'-]*(?:\s+\p{Lu}[\p{L}.'-]*){0,4},\s*(\d{2,3})\s*$/gmu;

/** Every age a page's text states, as a span: "46", "42-47", "Ages 40 to 44" and "In their 40s" are all spans. */
export function agesInText(text: string): AgeSpan[] {
  const spans: AgeSpan[] = [];
  const add = (low: number, high: number) => {
    if (low <= high && high <= MAX_AGE) spans.push({ low, high });
  };
  for (const match of text.matchAll(STATED_AGE_WORD)) {
    const low = Number(match[1]);
    add(low, match[2] === undefined ? low : Number(match[2]));
  }
  for (const pattern of [STATED_AGE_YEARS, STATED_AGE_PARENS, STATED_AGE_AFTER_NAME]) {
    for (const match of text.matchAll(pattern)) add(Number(match[1]), Number(match[1]));
  }
  for (const match of text.matchAll(STATED_AGE_DECADE)) {
    const low = Number(match[1]) * 10;
    add(low, low + 9);
  }
  return spans;
}

/** The ages a person born in `year` can be on any day of the year `today` falls in. */
export function ageSpanInYear(birthYear: number, thisYear: number): AgeSpan {
  return { low: thisYear - birthYear - 1, high: thisYear - birthYear };
}

function describeAge(span: AgeSpan): string {
  return span.low === span.high ? `${span.low}` : `${span.low}-${span.high}`;
}

/** Short chip text for one reason. */
export function describeReason(reason: MatchReason): string {
  switch (reason.kind) {
    case "age":
      return `Age ${describeAge(reason.candidate)}, you are ${describeAge(reason.profile)}`;
    case "place": {
      if (reason.weight === "neutral") return "No shared place";
      const verb = reason.past ? "Lived in" : "Lives in";
      return reason.city
        ? `${verb} ${reason.city}, ${reason.state}`
        : `Same state, ${reason.state}`;
    }
    case "name":
      if (reason.via === "middle") return "Middle initial differs";
      if (reason.via === "different") return "Different name";
      return reason.via === "variant" ? "Known name" : "Name matches";
    case "phone":
      return "Phone matches";
    case "email":
      return "Email matches";
  }
}

export function describeReasons(reasons: readonly MatchReason[]): string[] {
  return reasons.map(describeReason);
}
