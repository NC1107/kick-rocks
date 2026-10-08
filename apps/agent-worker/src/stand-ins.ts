import { type ProfileField, US_STATES } from "@kickrocks/shared";

export interface DropdownOption {
  value: string;
  label: string;
}

/** A detail of the person that a dropdown asks for, and the task fields that could answer it. */
export interface AskedDetail {
  words: string;
  answeredBy: readonly ProfileField[];
  /** Which piece of a date of birth the control asks for, when it is one of the three dropdowns. */
  part?: BirthPart;
}

export type BirthPart = "month" | "day" | "year" | "date";

const MONTHS = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

const BIRTH_HINT = /\b(birth|birthday|birthdate|dob|born|bday)\b|date of birth/i;
const STATE_HINT = /\b(state|province)\b/i;
const CITY_HINT = /\bcity\b|\btown\b/i;
const ZIP_HINT = /\b(zip|postal)\b/i;
const DAY_HINT = /\bday\b/i;
const MONTH_HINT = /\bmonth\b/i;
const YEAR_HINT = /\byear\b/i;

function normalized(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

function numbers(options: readonly DropdownOption[]): number[] {
  return options
    .map((option) => option.label.trim())
    .filter((label) => /^\d{1,4}$/.test(label))
    .map(Number);
}

function listsMonths(options: readonly DropdownOption[]): boolean {
  const labels = new Set(options.map((option) => normalized(option.label)));
  return MONTHS.filter((month) => labels.has(month) || labels.has(month.slice(0, 3))).length === 12;
}

function listsDays(options: readonly DropdownOption[]): boolean {
  const days = new Set(numbers(options));
  return Array.from({ length: 31 }, (_, i) => i + 1).every((day) => days.has(day));
}

function listsBirthYears(options: readonly DropdownOption[]): boolean {
  const years = numbers(options).filter((year) => year >= 1900 && year <= 2100);
  return years.length >= 40 && Math.min(...years) <= 1960;
}

function listsStates(options: readonly DropdownOption[]): boolean {
  const known = new Set(
    US_STATES.flatMap((state) => [state.code.toLowerCase(), normalized(state.name)]),
  );
  return options.filter((option) => known.has(normalized(option.label))).length >= 45;
}

/**
 * What a dropdown stands in for, when it asks for a detail of the person. The page's words name it
 * where they can, and the shape of the choices does where the label says nothing, as it does for
 * the three dropdowns of a date of birth. A choice made here without the person's value would be
 * an invented detail, which a typed field cannot be, so the toolbox refuses it.
 */
export function detailAskedFor(
  rawHint: string,
  options: readonly DropdownOption[],
): AskedDetail | null {
  const hint = rawHint.replace(/([a-z])([A-Z])/g, "$1 $2");
  const part = birthPartOf(hint, options);
  if (part !== null) {
    return {
      words: part === "year" ? "year of birth" : "date of birth",
      answeredBy: part === "year" ? ["birth_year", "date_of_birth"] : ["date_of_birth"],
      part,
    };
  }
  if (STATE_HINT.test(hint) || listsStates(options)) {
    return { words: "state", answeredBy: ["state"] };
  }
  if (CITY_HINT.test(hint)) return { words: "city", answeredBy: ["city"] };
  if (ZIP_HINT.test(hint)) return { words: "ZIP code", answeredBy: ["zip"] };
  return null;
}

function birthPartOf(hint: string, options: readonly DropdownOption[]): BirthPart | null {
  const birth = BIRTH_HINT.test(hint);
  if (listsMonths(options) || (birth && MONTH_HINT.test(hint))) return "month";
  if (listsBirthYears(options) || (birth && YEAR_HINT.test(hint))) return "year";
  if (listsDays(options) && (birth || DAY_HINT.test(hint))) return "day";
  return birth ? "date" : null;
}

/**
 * The labels or values a dropdown may use for one piece of the person's date of birth, which is
 * stored whole as an ISO date. Null means the field has no such piece, so nothing may be chosen.
 */
export function birthKeys(field: ProfileField, value: string, part: BirthPart): string[] | null {
  const match = /^(\d{4})(?:-(\d{2})-(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const [, year = "", month, day] = match;
  if (part === "year") return [year];
  if (field !== "date_of_birth" || month === undefined || day === undefined) return null;
  if (part === "month") {
    const name = MONTHS[Number(month) - 1] ?? "";
    return [String(Number(month)), month, name, name.slice(0, 3)];
  }
  if (part === "day") return [String(Number(day)), day];
  return [value.trim()];
}

/** The spellings of the person's state a dropdown may use: its postal code and its full name. */
export function stateSpellings(value: string): string[] {
  const text = value.trim();
  const state = US_STATES.find(
    (candidate) =>
      candidate.code === text.toUpperCase() || normalized(candidate.name) === normalized(text),
  );
  return state ? [state.code, state.name] : [text];
}
