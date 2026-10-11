import { z } from "zod";

export const MatchBand = z.enum(["likely", "maybe", "unlikely"]);
export type MatchBand = z.infer<typeof MatchBand>;

export const ReasonWeight = z.enum(["strong", "weak", "neutral", "weak_against", "contradicts"]);
export type ReasonWeight = z.infer<typeof ReasonWeight>;

const AgeSpan = z.object({ low: z.number().int(), high: z.number().int() });
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
    via: z.enum(["exact", "variant", "middle"]),
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
const STRONG_AGE_GAP = 2;
const WEAK_AGE_GAP = 5;
const FAR_AGE_GAP = 10;
/** A range wider than this says too little to confirm anyone. */
const NARROW_RANGE = 5;

const NAME_SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv", "v"]);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word !== "" && !NAME_SUFFIXES.has(word));
}

interface NameParts {
  first: string;
  middle: string;
  last: string;
}

function partsOf(name: string): NameParts | null {
  const flipped = name.includes(",") ? name.split(",").reverse().join(" ") : name;
  const tokens = words(flipped);
  const first = tokens[0];
  const last = tokens.at(-1);
  if (tokens.length < 2 || first === undefined || last === undefined) return null;
  return { first, middle: tokens.slice(1, -1).join(" "), last };
}

function nameReason(candidate: ScoreCandidate, profile: ScoreProfile): MatchReason | null {
  const shown = partsOf(candidate.name);
  if (shown === null) return null;
  const matching = profile.names.flatMap((name, index) => {
    const parts = partsOf([name.first, name.middle, name.last].filter(Boolean).join(" "));
    return parts && parts.first === shown.first && parts.last === shown.last
      ? [{ parts, primary: index === 0 }]
      : [];
  });
  if (matching.length === 0) return null;

  const middleAgrees = (parts: NameParts) =>
    parts.middle === "" || shown.middle === "" || parts.middle[0] === shown.middle[0];
  const agreeing = matching.find((entry) => middleAgrees(entry.parts));
  if (!agreeing) return { kind: "name", weight: "weak_against", via: "middle" };
  return { kind: "name", weight: "strong", via: agreeing.primary ? "exact" : "variant" };
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
  return { low: todayYear - year - 1, high: todayYear - year };
}

function candidateAge(candidate: ScoreCandidate, today: string): AgeSpan | null {
  if (candidate.ageRange) return candidate.ageRange;
  if (candidate.age !== undefined) return { low: candidate.age, high: candidate.age };
  if (candidate.birthYear !== undefined) {
    const age = Number(today.slice(0, 4)) - candidate.birthYear;
    return { low: age - 1, high: age };
  }
  return null;
}

function gapBetween(a: AgeSpan, b: AgeSpan): number {
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
  const gap = gapBetween(shown, own);
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

function placeOf(text: string): Place | null {
  const found = /^(.+?),\s*([A-Za-z]{2})\.?$/.exec(text.trim());
  if (!found) return null;
  return {
    city: (found[1] as string).trim().toLowerCase(),
    state: (found[2] as string).toUpperCase(),
  };
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
    const gap = gapBetween(reason.candidate, reason.profile);
    return gap > FAR_AGE_GAP ? FAR_CONTRADICTION_POINTS : POINTS.contradicts;
  }
  return POINTS[reason.weight];
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
  const contradicted = reasons.some((reason) => reason.weight === "contradicts");
  let band: MatchBand = "maybe";
  if (score <= UNLIKELY_UNTIL) band = "unlikely";
  else if (score >= LIKELY_FROM && !contradicted) band = "likely";
  return { band, score, reasons };
}

const AGE_RANGE = /\b(\d{1,3})\s*(?:-|–|—|to)\s*(\d{1,3})\b/;
const AGE_DECADE = /\b([1-9])0['’]?s\b/i;
const AGE_SINGLE = /\b(\d{1,3})\b/;

/** The ages a scan card states, such as "47", "Ages 42-47" or "In their 40s". */
export function parseAgeText(text: string): AgeSpan | null {
  const range = AGE_RANGE.exec(text);
  if (range) {
    const low = Number(range[1]);
    const high = Number(range[2]);
    if (low <= high && high <= 120) return { low, high };
  }
  const decade = AGE_DECADE.exec(text);
  if (decade) {
    const low = Number(decade[1]) * 10;
    return { low, high: low + 9 };
  }
  const single = AGE_SINGLE.exec(text);
  const age = single ? Number(single[1]) : Number.NaN;
  return age > 0 && age <= 120 ? { low: age, high: age } : null;
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
