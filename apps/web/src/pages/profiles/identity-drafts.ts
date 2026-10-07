import {
  type Identity,
  IdentityInput,
  type IdentityKind,
  type PersonName,
  validateIdentities,
} from "@kickrocks/shared";

/**
 * One identity as the person is editing it. Every field is a string so a half-typed value can sit
 * in an input; `toInput` turns a draft into the shape the API takes.
 */
export interface IdentityDraft {
  key: string;
  kind: IdentityKind;
  isPrimary: boolean;
  validFrom: string;
  validTo: string;
  first: string;
  middle: string;
  last: string;
  address: string;
  number: string;
  street: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
  date: string;
}

/** Kinds where resolution picks one primary. An alias is only ever an extra spelling. */
const PRIMARY_KINDS: ReadonlySet<IdentityKind> = new Set([
  "name",
  "email",
  "phone",
  "address",
  "dob",
]);

export const hasPrimary = (kind: IdentityKind) => PRIMARY_KINDS.has(kind);

let counter = 0;
const nextKey = () => `draft-${++counter}`;

export function emptyDraft(kind: IdentityKind): IdentityDraft {
  return {
    key: nextKey(),
    kind,
    isPrimary: false,
    validFrom: "",
    validTo: "",
    first: "",
    middle: "",
    last: "",
    address: "",
    number: "",
    street: "",
    unit: "",
    city: "",
    state: "",
    zip: "",
    date: "",
  };
}

function toDraft(identity: Identity): IdentityDraft {
  const draft: IdentityDraft = {
    ...emptyDraft(identity.kind),
    isPrimary: identity.isPrimary,
    validFrom: identity.validFrom ?? "",
    validTo: identity.validTo ?? "",
  };
  switch (identity.kind) {
    case "name":
    case "alias":
      draft.first = identity.value.first;
      draft.middle = identity.value.middle ?? "";
      draft.last = identity.value.last;
      break;
    case "email":
      draft.address = identity.value.address;
      break;
    case "phone":
      draft.number = identity.value.number;
      break;
    case "address":
      draft.street = identity.value.street;
      draft.unit = identity.value.unit ?? "";
      draft.city = identity.value.city;
      draft.state = identity.value.state;
      draft.zip = identity.value.zip;
      break;
    case "dob":
      draft.date = identity.value.date;
      break;
  }
  return draft;
}

/** Makes sure each kind that has rows has exactly one primary, and an alias has none. */
export function normalizePrimaries(drafts: readonly IdentityDraft[]): IdentityDraft[] {
  const seen = new Set<IdentityKind>();
  const kept = drafts.map((draft) => {
    if (!hasPrimary(draft.kind)) return draft.isPrimary ? { ...draft, isPrimary: false } : draft;
    if (draft.isPrimary && !seen.has(draft.kind)) {
      seen.add(draft.kind);
      return draft;
    }
    return draft.isPrimary ? { ...draft, isPrimary: false } : draft;
  });
  return kept.map((draft) => {
    if (!hasPrimary(draft.kind) || seen.has(draft.kind)) return draft;
    seen.add(draft.kind);
    return { ...draft, isPrimary: true };
  });
}

export function toDrafts(identities: readonly Identity[]): IdentityDraft[] {
  return normalizePrimaries(identities.map(toDraft));
}

/** The starting point of a new profile: a blank primary name and a blank primary email. */
export function startingDrafts(): IdentityDraft[] {
  return normalizePrimaries([emptyDraft("name"), emptyDraft("email")]);
}

export function addDraft(drafts: readonly IdentityDraft[], kind: IdentityKind): IdentityDraft[] {
  return normalizePrimaries([...drafts, emptyDraft(kind)]);
}

export function removeDraft(drafts: readonly IdentityDraft[], key: string): IdentityDraft[] {
  return normalizePrimaries(drafts.filter((draft) => draft.key !== key));
}

export function makePrimary(drafts: readonly IdentityDraft[], key: string): IdentityDraft[] {
  const target = drafts.find((draft) => draft.key === key);
  if (!target || !hasPrimary(target.kind)) return [...drafts];
  return drafts.map((draft) =>
    draft.kind === target.kind ? { ...draft, isPrimary: draft.key === key } : draft,
  );
}

export function updateDraft(
  drafts: readonly IdentityDraft[],
  key: string,
  change: Partial<IdentityDraft>,
): IdentityDraft[] {
  return drafts.map((draft) => (draft.key === key ? { ...draft, ...change } : draft));
}

/**
 * Accepts the ways people type a US number and gives E.164. Anything it cannot read confidently is
 * returned trimmed, so validation can say what is wrong instead of the field changing underneath
 * the person.
 */
export function normalizePhone(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return trimmed;
}

const optional = (text: string) => {
  const trimmed = text.trim();
  return trimmed === "" ? undefined : trimmed;
};

function nameValue(draft: IdentityDraft): PersonName {
  const middle = optional(draft.middle);
  return {
    first: draft.first.trim(),
    last: draft.last.trim(),
    ...(middle ? { middle } : {}),
  };
}

/** The value of a draft as the API takes it. It may still be invalid; validateDrafts says why. */
export function toInput(draft: IdentityDraft): unknown {
  const lifetime = {
    isPrimary: draft.isPrimary,
    validFrom: draft.validFrom || null,
    validTo: draft.validTo || null,
  };
  switch (draft.kind) {
    case "name":
    case "alias":
      return { kind: draft.kind, value: nameValue(draft), ...lifetime };
    case "email":
      return { kind: "email", value: { address: draft.address.trim() }, ...lifetime };
    case "phone":
      return { kind: "phone", value: { number: normalizePhone(draft.number) }, ...lifetime };
    case "address": {
      const unit = optional(draft.unit);
      return {
        kind: "address",
        value: {
          street: draft.street.trim(),
          ...(unit ? { unit } : {}),
          city: draft.city.trim(),
          state: draft.state,
          zip: draft.zip.trim(),
        },
        ...lifetime,
      };
    }
    case "dob":
      return { kind: "dob", value: { date: draft.date }, ...lifetime };
  }
}

export function toInputs(drafts: readonly IdentityDraft[]): IdentityInput[] {
  return drafts.map((draft) => toInput(draft) as IdentityInput);
}

export interface DraftErrors {
  /** Per field, keyed "<row index>.<path>" such as "0.value.address" or "2.validTo". */
  fields: Record<string, string>;
  /** Per kind, for a rule about the whole group such as "add an email". */
  sections: Partial<Record<IdentityKind, string>>;
  /** Anything that did not belong to a field or a section. */
  general: string[];
}

export const NO_ERRORS: DraftErrors = { fields: {}, sections: {}, general: [] };

export const hasErrors = (errors: DraftErrors) =>
  Object.keys(errors.fields).length > 0 ||
  Object.keys(errors.sections).length > 0 ||
  errors.general.length > 0;

export const fieldKey = (index: number, path: string) => `${index}.${path}`;

const BLANK_AFTER_TRIM = "Required";

function friendlyMessage(path: (string | number)[], blank: boolean, fallback: string): string {
  if (blank) return BLANK_AFTER_TRIM;
  const last = path.at(-1);
  if (last === "address") return "Enter a valid email address";
  if (last === "number") return "Enter a number with area code, such as (555) 555-0123";
  if (last === "state") return "Choose a state";
  if (last === "date") return "Enter a valid date";
  if (/too big|too long|<=|at most/i.test(fallback)) return "Too long";
  return fallback;
}

function isBlank(draft: IdentityDraft, path: (string | number)[]): boolean {
  const field = path.at(-1);
  switch (field) {
    case "first":
    case "last":
    case "street":
    case "city":
    case "state":
    case "zip":
    case "date":
    case "number":
    case "address":
      return draft[field].trim() === "";
    default:
      return false;
  }
}

/** Which kind a whole-group rule is about, and the words to show for it. */
function sectionIssue(message: string): { kind: IdentityKind; text: string } | null {
  if (/primary name/i.test(message))
    return { kind: "name", text: "Add a name and mark it primary." };
  if (/at least one email/i.test(message))
    return { kind: "email", text: "Add at least one email address." };
  const only = /only one primary (\w+)/i.exec(message);
  return only?.[1] ? { kind: only[1] as IdentityKind, text: message } : null;
}

/**
 * Checks every draft with the shared schema, then the rules that span identities, and gives
 * messages a person can act on. `today` is the date a birth date must not pass.
 */
export function validateDrafts(drafts: readonly IdentityDraft[], today: string): DraftErrors {
  const errors: DraftErrors = { fields: {}, sections: {}, general: [] };
  const set = (index: number, path: (string | number)[], message: string) => {
    const key = fieldKey(index, path.join("."));
    if (!(key in errors.fields)) errors.fields[key] = message;
  };

  const inputs = toInputs(drafts);
  drafts.forEach((draft, index) => {
    const parsed = IdentityInput.safeParse(inputs[index]);
    if (parsed.success) return;
    for (const issue of parsed.error.issues) {
      const path = issue.path.map((part) => (typeof part === "symbol" ? String(part) : part));
      if (path[0] === "value" && path.length === 1) continue;
      set(index, path, friendlyMessage(path, isBlank(draft, path), issue.message));
    }
  });

  for (const issue of validateIdentities(inputs, today)) {
    const [index, ...path] = issue.path;
    if (typeof index === "number") {
      set(index, path, issue.message);
      continue;
    }
    const section = sectionIssue(issue.message);
    if (section) {
      errors.sections[section.kind] ??= section.text;
    } else {
      errors.general.push(issue.message);
    }
  }

  const seenEmails = new Map<string, number>();
  drafts.forEach((draft, index) => {
    if (draft.kind !== "email" || !draft.address.trim()) return;
    const address = draft.address.trim().toLowerCase();
    if (seenEmails.has(address)) set(index, ["value", "address"], "Already listed above");
    else seenEmails.set(address, index);
  });

  return errors;
}

/**
 * Sorts the field errors a server answered with, such as "identities.0.value.address", onto the
 * rows they belong to. Whatever does not name a row is kept to show above the form.
 */
export function serverErrors(fieldErrors: Readonly<Record<string, string>>): DraftErrors {
  const errors: DraftErrors = { fields: {}, sections: {}, general: [] };
  for (const [key, message] of Object.entries(fieldErrors)) {
    const row = /^identities\.(\d+)\.(.+)$/.exec(key);
    if (row?.[1] && row[2]) {
      errors.fields[fieldKey(Number(row[1]), row[2])] = message;
      continue;
    }
    const section = sectionIssue(message);
    if (section) errors.sections[section.kind] = section.text;
    else errors.general.push(message);
  }
  return errors;
}

/** What the draft list would send, for telling whether anything changed. */
export function snapshot(drafts: readonly IdentityDraft[]): string {
  return JSON.stringify(toInputs(drafts));
}

/** The name to list a profile under when the person did not type one. */
export function defaultDisplayName(drafts: readonly IdentityDraft[]): string {
  const name = drafts.find((draft) => draft.kind === "name" && draft.isPrimary);
  if (!name) return "";
  return [name.first, name.middle, name.last]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 80);
}

/** Today as YYYY-MM-DD in the person's own time zone. */
export function localToday(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}
