import { type ProfileField, US_STATES } from "@kickrocks/shared";

export interface DropdownOption {
  value: string;
  label: string;
}

/** A detail of the person that a dropdown asks for, and the task fields that could answer it. */
export interface AskedDetail {
  words: string;
  answeredBy: readonly ProfileField[];
}

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
  hint: string,
  options: readonly DropdownOption[],
): AskedDetail | null {
  if (BIRTH_HINT.test(hint) || listsMonths(options) || listsBirthYears(options)) {
    const year = listsBirthYears(options);
    return {
      words: year ? "year of birth" : "date of birth",
      answeredBy: year ? ["birth_year", "date_of_birth"] : ["date_of_birth"],
    };
  }
  if (DAY_HINT.test(hint) && listsDays(options)) {
    return { words: "date of birth", answeredBy: ["date_of_birth"] };
  }
  if (STATE_HINT.test(hint) || listsStates(options)) {
    return { words: "state", answeredBy: ["state"] };
  }
  if (CITY_HINT.test(hint)) return { words: "city", answeredBy: ["city"] };
  if (ZIP_HINT.test(hint)) return { words: "ZIP code", answeredBy: ["zip"] };
  return null;
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
