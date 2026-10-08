import { createHash } from "node:crypto";
import {
  type CarriedField,
  LOOKUP_FIELDS,
  namedHiddenValues,
  OTHER_VALUE,
  type ProfileField,
  type ProfileFields,
  slugify,
  US_STATES,
} from "@kickrocks/shared";
import { variantsOf } from "../mask.js";
import { type Packaged, readAll } from "./decode.js";

export type ValueClass = "contact" | "lookup";

interface Needle {
  text: string;
  field: CarriedField;
  cls: ValueClass;
  /** Short and numeric values match only as a whole value or a delimited token. */
  strict: boolean;
  pattern?: RegExp;
}

export interface Scan {
  fields: CarriedField[];
  contact: boolean;
  lookup: boolean;
  /** The request could not be read in full, so nothing can be said about what it carries. */
  overflow: boolean;
}

const MIN_VALUE_LENGTH = 2;
const MIN_PREFIX_LENGTH = 6;
const MIN_REVERSED_LENGTH = 6;
const STRICT_BELOW = 5;
const HASHES = ["md5", "sha1", "sha256"] as const;

/** Case and width folding, applied to a value and to everything it is looked for in. */
export function fold(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/ß/g, "ss").replace(/\s+/g, " ").trim();
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function classOf(field: CarriedField): ValueClass {
  return field !== OTHER_VALUE && LOOKUP_FIELDS.includes(field as ProfileField)
    ? "lookup"
    : "contact";
}

function digitsOf(text: string): string {
  return text.replace(/\D/g, "");
}

/** The forms an ad pixel hashes: the lowercased value, E.164 digits, a date without separators. */
function hashedForms(field: CarriedField, value: string): string[] {
  const lower = value.trim().toLowerCase();
  switch (field) {
    case "email":
      return [lower];
    case "phone": {
      const digits = digitsOf(value);
      const national = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
      return [`+1${national}`, `1${national}`, national];
    }
    case "first_name":
    case "last_name":
    case "city":
    case "zip":
      return [lower];
    case "date_of_birth": {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
      return match ? [`${match[1]}${match[2]}${match[3]}`, value.trim()] : [];
    }
    default:
      return field === OTHER_VALUE ? [lower] : [];
  }
}

function hashesOf(form: string): string[] {
  return HASHES.flatMap((algorithm) => {
    const digest = createHash(algorithm).update(form).digest();
    const base64 = digest.toString("base64");
    return [
      digest.toString("hex"),
      base64,
      base64.replace(/=+$/, ""),
      base64.replace(/\+/g, "-").replace(/\//g, "_"),
      base64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""),
    ];
  });
}

function nameJoins(first: string | undefined, last: string | undefined): string[] {
  if (!first || !last) return [];
  const separators = [" ", "+", "%20", "-", "_", ".", ", "];
  return separators.flatMap((separator) => [
    `${first}${separator}${last}`,
    `${last}${separator}${first}`,
  ]);
}

/** Every spelling of one value that the gate looks for. */
function spellingsOf(field: CarriedField, value: string): string[] {
  const spellings = new Set<string>([value]);
  const slug = slugify(value);
  if (slug.length >= 3) spellings.add(slug);
  if (field === "date_of_birth") {
    for (const spelling of variantsOf(field, value)) spellings.add(spelling);
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
    if (match) {
      spellings.add(`${match[1]}${match[2]}${match[3]}`);
      spellings.add(`${match[1]}/${match[2]}/${match[3]}`);
    }
  }
  if (field === "phone") {
    for (const spelling of variantsOf(field, value)) spellings.add(spelling);
    const digits = digitsOf(value);
    if (digits.length >= 7) spellings.add(digits);
  }
  if (field === "state") {
    const state = US_STATES.find((candidate) => candidate.code === value.trim().toUpperCase());
    if (state) spellings.add(state.name);
  }
  if (field === "record_url") spellings.add(value.replace(/^https?:\/\//i, ""));
  return [...spellings];
}

/**
 * Recognizes the person's details in an outgoing request, in the spellings and the packings a
 * page could put them in. A match is a reason to hold or refuse, never a finding of intent, so a
 * false match only breaks a page.
 */
export class ValueDetector {
  private readonly needles: Needle[] = [];
  private readonly whole = new Map<string, CarriedField>();

  constructor(fields: ProfileFields, maskValues: readonly string[] = []) {
    const entries: [CarriedField, string][] = [];
    for (const [name, raw] of Object.entries(fields)) {
      const value = raw?.trim();
      if (value && value.length >= MIN_VALUE_LENGTH) entries.push([name as ProfileField, value]);
    }
    for (const value of Object.values(namedHiddenValues(fields, maskValues))) {
      if (value.length >= MIN_VALUE_LENGTH) entries.push([OTHER_VALUE, value]);
    }
    for (const [field, value] of entries) {
      this.addValue(field, value);
      if (!this.whole.has(fold(value))) this.whole.set(fold(value), field);
    }
    this.addPrefixes();
    this.addReversed(entries);
    for (const join of nameJoins(fields.first_name?.trim(), fields.last_name?.trim())) {
      this.add("full_name", join);
    }
  }

  private add(field: CarriedField, text: string): void {
    const folded = fold(text);
    if (folded.length < MIN_VALUE_LENGTH) return;
    if (this.needles.some((needle) => needle.text === folded && needle.field === field)) return;
    const strict = folded.length < STRICT_BELOW || /^\d+$/.test(folded);
    const needle: Needle = { text: folded, field, cls: classOf(field), strict };
    if (strict) {
      needle.pattern = new RegExp(
        `(?<![\\p{L}\\p{N}])${escapeRegExp(folded)}(?![\\p{L}\\p{N}])`,
        "u",
      );
    }
    this.needles.push(needle);
  }

  private addValue(field: CarriedField, value: string): void {
    for (const spelling of spellingsOf(field, value)) this.add(field, spelling);
    for (const form of hashedForms(field, value)) {
      for (const hash of hashesOf(form)) this.add(field, hash);
    }
  }

  /**
   * The first characters of a contact value, for a page that uploads it as it is typed. Only the
   * shortest prefix that is not itself a lookup value is kept, since every longer one contains it.
   */
  private addPrefixes(): void {
    const lookups = new Set(
      this.needles.filter((needle) => needle.cls === "lookup").map((needle) => needle.text),
    );
    const contacts = this.needles.filter(
      (needle) => needle.cls === "contact" && !needle.strict && /[a-z@.]/.test(needle.text),
    );
    for (const needle of contacts) {
      if (!["email", OTHER_VALUE].includes(needle.field) || needle.text.length <= MIN_PREFIX_LENGTH)
        continue;
      for (let length = MIN_PREFIX_LENGTH; length < needle.text.length; length++) {
        const prefix = needle.text.slice(0, length);
        if (lookups.has(prefix) || this.isLookupSubstring(prefix)) continue;
        this.add(needle.field, prefix);
        break;
      }
    }
  }

  /**
   * A contact value written backwards, which a page can undo on its own server and no packing
   * detector undoes for it. Names and places are left out, since their reversals are not
   * distinctive enough to be worth a held request.
   */
  private addReversed(entries: readonly [CarriedField, string][]): void {
    for (const [field, value] of entries) {
      if (classOf(field) !== "contact") continue;
      for (const spelling of spellingsOf(field, value)) {
        const reversed = [...fold(spelling)].reverse().join("");
        if (reversed.length >= MIN_REVERSED_LENGTH) this.add(field, reversed);
      }
    }
  }

  private isLookupSubstring(prefix: string): boolean {
    return this.needles.some((needle) => needle.cls === "lookup" && needle.text.includes(prefix));
  }

  /** The field a text is exactly the value of, when it is one, so it can be shown as its placeholder. */
  fieldOfWhole(text: string): CarriedField | null {
    return this.whole.get(fold(text)) ?? null;
  }

  get isEmpty(): boolean {
    return this.needles.length === 0;
  }

  /** Looks for the person's details in all of the pieces and in everything they unpack to. */
  scan(pieces: readonly (string | Packaged)[]): Scan {
    const fields = new Set<CarriedField>();
    let overflow = false;
    const inputs = pieces.map(
      (piece): Packaged => (typeof piece === "string" ? { data: piece } : piece),
    );
    const reading = readAll(inputs);
    overflow = reading.overflow;
    for (const raw of reading.texts) {
      const text = fold(raw);
      if (text === "") continue;
      for (const needle of this.needles) {
        if (fields.has(needle.field)) continue;
        const hit = needle.pattern ? needle.pattern.test(text) : text.includes(needle.text);
        if (hit) fields.add(needle.field);
      }
    }
    const found = [...fields].sort();
    return {
      fields: found,
      contact: found.some((field) => classOf(field) === "contact"),
      lookup: found.some((field) => classOf(field) === "lookup"),
      overflow,
    };
  }
}
