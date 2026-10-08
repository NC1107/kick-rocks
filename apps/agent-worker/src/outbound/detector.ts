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
const RUN_LENGTH = 6;
const MIN_REVERSED_LENGTH = 6;
/** Mailbox providers whose names say nothing about the person, so a run inside one is not a leak. */
const COMMON_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "msn.com",
  "icloud.com",
  "me.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "comcast.net",
  "verizon.net",
  "att.net",
];
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
  private readonly runs = new Map<string, CarriedField>();
  private readonly runStarts = new Set<number>();

  /** `domains` are the target's own, which a page may name without giving anything away. */
  constructor(
    fields: ProfileFields,
    maskValues: readonly string[] = [],
    domains: readonly string[] = [],
  ) {
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
    this.addRuns(entries, domains);
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
   * Every run of six characters in a contact value, so a page that sends a piece of one, or the
   * value as it is typed, is recognized by a piece alone. A run that sits inside a value the task
   * allows in a search, or inside a domain that names no one, is left out, since the page may
   * send those on their own.
   */
  private addRuns(entries: readonly [CarriedField, string][], domains: readonly string[]): void {
    const allowed = [
      ...entries
        .filter(([field]) => classOf(field) === "lookup")
        .flatMap(([field, value]) => spellingsOf(field, value).map(fold)),
      ...[...COMMON_DOMAINS, ...domains].map((domain) => fold(domain).replace(/^\./, "")),
    ];
    for (const [field, value] of entries) {
      if (classOf(field) !== "contact") continue;
      for (const spelling of spellingsOf(field, value)) {
        const text = fold(spelling);
        for (let start = 0; start + RUN_LENGTH <= text.length; start++) {
          const run = text.slice(start, start + RUN_LENGTH);
          if (this.runs.has(run) || allowed.some((known) => known.includes(run))) continue;
          this.runs.set(run, field);
          this.runStarts.add(run.charCodeAt(0));
        }
      }
    }
  }

  /**
   * A contact value written backwards, which a page can undo on its own server and no packing
   * detector undoes for it. Hidden values such as a name or a city are reversed too, because they
   * are contact values to the gate, so a request that carries "nadroj" is held.
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

  /** The field a text is exactly the value of, when it is one, so it can be shown as its placeholder. */
  fieldOfWhole(text: string): CarriedField | null {
    return this.whole.get(fold(text)) ?? null;
  }

  get isEmpty(): boolean {
    return this.needles.length === 0 && this.runs.size === 0;
  }

  private scanRuns(text: string, fields: Set<CarriedField>): void {
    if (this.runs.size === 0) return;
    for (let start = 0; start + RUN_LENGTH <= text.length; start++) {
      if (!this.runStarts.has(text.charCodeAt(start))) continue;
      const field = this.runs.get(text.slice(start, start + RUN_LENGTH));
      if (field !== undefined) fields.add(field);
    }
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
      this.scanRuns(text, fields);
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
