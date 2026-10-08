import { createRedactor } from "@kickrocks/recipes";
import { namedHiddenValues, type ProfileFields, US_STATES } from "@kickrocks/shared";

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
export function variantsOf(name: string, value: string): string[] {
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

const NOT_ALNUM_BEFORE = "(?<![A-Za-z0-9])";
const NOT_ALNUM_AFTER = "(?![A-Za-z0-9])";

/**
 * Where a bare capital code can only be a state: after a comma or a masked city, before a ZIP,
 * after the word state or an equals sign, and as a whole choice of a list. Anywhere else it is
 * an ordinary word such as OK, IN, OR or ME, which a button or a heading uses.
 */
function addressContexts(code: string): RegExp[] {
  const zip = String.raw`\s*,?\s*(?:\d{5}(?:-\d{4})?|\{\{zip\}\})`;
  const choice = String.raw`(?<=options: "|" \| "|\b(?:option|menuitem|radio) "|value=")${code}(?=["]|\s+[-–:]\s)`;
  return [
    new RegExp(String.raw`(?<=,\s*)${code}${NOT_ALNUM_AFTER}`, "g"),
    new RegExp(String.raw`(?<=\{\{city\}\},?\s*)${code}${NOT_ALNUM_AFTER}`, "g"),
    new RegExp(`${NOT_ALNUM_BEFORE}${code}(?=${zip})`, "g"),
    new RegExp(String.raw`(?<=[Ss][Tt][Aa][Tt][Ee]:?\s+)${code}${NOT_ALNUM_AFTER}`, "g"),
    new RegExp(`(?<==)${code}${NOT_ALNUM_AFTER}`, "g"),
    new RegExp(choice, "g"),
  ];
}

/**
 * The path and query of an address are read in any case, because a site writes the state in lower
 * case there (a slug ending in -tx, ?state=tx) and no ordinary word is spelled that way. The host
 * is left alone: it is not where a state is, and a code such as id would hit id.me.
 */
function hideInAddresses(text: string, code: string, label: string): string {
  const inAddress = new RegExp(
    `(?:${NOT_ALNUM_BEFORE}|(?<=%2[Cc]))${code}${NOT_ALNUM_AFTER}`,
    "gi",
  );
  return text.replace(
    /(https?:\/\/[^/\s"?#]*)([^\s"]*)/g,
    (_, host: string, rest: string) => `${host}${rest.replace(inAddress, label)}`,
  );
}

/** The names another state ends with: "West " in front of Virginia makes it a different state. */
function prefixesOf(name: string): string[] {
  return US_STATES.filter((other) =>
    other.name.toLowerCase().endsWith(` ${name.toLowerCase()}`),
  ).map((other) => other.name.slice(0, other.name.length - name.length).trim());
}

/**
 * A state is two letters, which the redactor ignores because a short value would match inside
 * ordinary words. Its full name is hidden wherever it stands, since a page spells the same state
 * both ways, but the code only where it reads as a state.
 */
function stateRedactor(entries: [string, string][]): Redact {
  const steps = entries.flatMap(([name, value]): Redact[] => {
    const text = value.trim();
    const isCode = /^[A-Za-z]{2}$/.test(text);
    if (name !== "state" && !(isCode && text === text.toUpperCase())) return [];
    const state = US_STATES.find(
      (candidate) =>
        candidate.code === text.toUpperCase() ||
        (name === "state" && candidate.name.toLowerCase() === text.toLowerCase()),
    );
    if (!state) return [];
    const label = `{{${name}}}`;
    const spelledOut = state.name.replace(/ /g, String.raw`\s+`);
    const notPartOfAnother = prefixesOf(state.name)
      .map((prefix) => String.raw`(?<!\b${prefix.replace(/ /g, String.raw`\s+`)}\s+)`)
      .join("");
    const fullName = new RegExp(
      `${NOT_ALNUM_BEFORE}${notPartOfAnother}${spelledOut}${NOT_ALNUM_AFTER}`,
      "gi",
    );
    const contexts = addressContexts(state.code);
    return [
      (text) => text.replace(fullName, label),
      (text) => contexts.reduce((current, pattern) => current.replace(pattern, label), text),
      (text) => hideInAddresses(text, state.code, label),
    ];
  });
  return (text) => steps.reduce((current, step) => step(current), text);
}

type NamedValues = Record<string, string | undefined>;

export { namedHiddenValues };

/** Puts the person's values back where a {{field}} placeholder stands, for text the model copied. */
export function restoreFields(text: string, fields: NamedValues): string {
  return text.replace(/\{\{(\w+)\}\}/g, (placeholder, name: string) => {
    const value = fields[name];
    return value === undefined || value === "" ? placeholder : value;
  });
}

/**
 * Hides the person's values in text the model reads or the server stores. The recipe runner's
 * redactor knows every URL and markup spelling of a value, form-urlencoded ones included. A page's input mask
 * can reformat a phone number or a date, so those fields also hide their common US formats.
 */
export function createMask(fields: ProfileFields, hidden: readonly string[] = []): Redact {
  const everything: NamedValues = { ...fields, ...namedHiddenValues(fields, hidden) };
  const entries = Object.entries(everything).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string" && entry[1].trim() !== "",
  );
  const plain = createRedactor(everything as ProfileFields);
  const reformatted = redactorFor(
    entries.flatMap(([name, value]) =>
      variantsOf(name, value).map((spelling): [string, string] => [name, spelling]),
    ),
  );
  // The long spellings go first: a date such as 04/05/1990 must not lose its year to the birth year alone.
  const states = stateRedactor(entries);
  return (text) => states(plain(reformatted(text)));
}
