import { createRedactor } from "@kickrocks/recipes";
import type { ProfileFields } from "@kickrocks/shared";

type Redact = (text: string) => string;

/** The spellings an input mask or a formatted display gives a US phone number. */
function phoneSpellings(number: string): string[] {
  const digits = number.replace(/\D/g, "");
  const local = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (local.length !== 10) return [];
  const [area, exchange, line] = [local.slice(0, 3), local.slice(3, 6), local.slice(6)];
  return [
    local,
    `1${local}`,
    `+1${local}`,
    `(${area}) ${exchange}-${line}`,
    `(${area})${exchange}-${line}`,
    `${area}-${exchange}-${line}`,
    `${area}.${exchange}.${line}`,
    `${area} ${exchange} ${line}`,
    `+1 ${area} ${exchange} ${line}`,
    `+1 (${area}) ${exchange}-${line}`,
    `1-${area}-${exchange}-${line}`,
  ];
}

/** The US spellings of an ISO date, which is how the person's date of birth is stored. */
function dateSpellings(date: string): string[] {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date.trim());
  if (!match) return [];
  const [, year = "", month = "", day = ""] = match;
  const [m, d] = [String(Number(month)), String(Number(day))];
  return [
    `${month}/${day}/${year}`,
    `${m}/${d}/${year}`,
    `${month}-${day}-${year}`,
    `${m}-${d}-${year}`,
    `${month}.${day}.${year}`,
  ];
}

const E164 = /^\+[1-9]\d{6,14}$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Other spellings of a value that a page's input mask or layout may use instead of the stored one. */
function variantsOf(name: string, value: string): string[] {
  if (name === "phone" || E164.test(value)) return phoneSpellings(value);
  if (name === "date_of_birth" || ISO_DATE.test(value)) return dateSpellings(value);
  return [];
}

/** Longest spellings go first, so a spelling that contains another is not left half replaced. */
function redactorFor(entries: [string, string][]): Redact {
  const redactors = [...entries]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([name, value]) => createRedactor({ [name]: value } as ProfileFields));
  return (text) => redactors.reduce((current, redact) => redact(current), text);
}

type NamedValues = Record<string, string | undefined>;

/**
 * Names the person's other values, the ones the task has no field for, so a page that shows one
 * reads {{other_3}} to the model and the program can still put the value back in what it reports.
 * A value the task's fields already hide keeps its field's name.
 */
export function namedHiddenValues(
  fields: ProfileFields,
  hidden: readonly string[],
): Record<string, string> {
  const seen = new Set(Object.values(fields).map((value) => value?.trim().toLowerCase()));
  const named: Record<string, string> = {};
  for (const raw of hidden) {
    const value = raw.trim();
    if (value === "" || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    named[`other_${Object.keys(named).length + 1}`] = value;
  }
  return named;
}

/** Puts the person's values back where a {{field}} placeholder stands, for text the model copied. */
export function restoreFields(text: string, fields: NamedValues): string {
  return text.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => {
    const value = fields[name];
    return value === undefined || value === "" ? placeholder : value;
  });
}

/**
 * Hides the person's values in text the model reads or the server stores. The recipe runner's
 * redactor knows the plain, percent-encoded and slug spellings; a form submitted by GET puts a
 * space in the address as a plus sign, so that spelling is covered here too. A page's input mask
 * can reformat a phone number or a date, so those fields also hide their common US formats.
 */
export function createMask(fields: ProfileFields, hidden: readonly string[] = []): Redact {
  const everything: NamedValues = { ...fields, ...namedHiddenValues(fields, hidden) };
  const entries = Object.entries(everything).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "",
  );
  const plain = createRedactor(everything as ProfileFields);
  const withPlus = createRedactor(
    Object.fromEntries(entries.map(([name, value]) => [name, value.replaceAll(" ", "+")])),
  );
  const reformatted = redactorFor(
    entries.flatMap(([name, value]) =>
      variantsOf(name, value).map((spelling): [string, string] => [name, spelling]),
    ),
  );
  // The long spellings go first: a date such as 04/05/1990 must not lose its year to the birth year alone.
  return (text) => withPlus(plain(reformatted(text)));
}
