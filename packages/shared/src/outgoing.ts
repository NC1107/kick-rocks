import { z } from "zod";
import { ProfileField, type ProfileFields } from "./identities.js";

/**
 * Values that may travel in a GET or HEAD to the target's own sites: they identify a person to a
 * search, and the gate logs them without holding anything.
 */
export const LOOKUP_FIELDS: readonly ProfileField[] = [
  "first_name",
  "last_name",
  "full_name",
  "city",
  "state",
  "zip",
  "birth_year",
  "record_url",
];

/** Everything else a person holds. Any request that carries one is a send. */
export const CONTACT_FIELDS: readonly ProfileField[] = [
  "email",
  "phone",
  "street",
  "date_of_birth",
];

/** A value the profile holds that no field of the task names, such as a middle name. */
export const OTHER_VALUE = "other";

export const CarriedField = z.union([ProfileField, z.literal(OTHER_VALUE)]);
export type CarriedField = z.infer<typeof CarriedField>;

export function isContactField(field: CarriedField): boolean {
  return field === OTHER_VALUE || CONTACT_FIELDS.includes(field);
}

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

export const OutgoingValueClass = z.enum(["profile", "served_token", "literal"]);
export type OutgoingValueClass = z.infer<typeof OutgoingValueClass>;

/**
 * One name and value that leaves the browser, with the person's own values already replaced by
 * their placeholders. A `profile` value holds one, a `served_token` is one the site itself put in
 * the page, and a `literal` is anything else.
 */
export const OutgoingValue = z.object({
  path: z.string().max(400),
  value: z.string().max(4000),
  class: OutgoingValueClass,
  fields: z.array(CarriedField).max(16).optional(),
});
export type OutgoingValue = z.infer<typeof OutgoingValue>;

export const BodyKind = z.enum(["none", "form", "json", "multipart", "text", "opaque"]);
export type BodyKind = z.infer<typeof BodyKind>;

/** A request the browser is about to make, in the form a person reviews and the server stores. */
export const OutgoingRequest = z.object({
  method: z.string().max(16),
  scheme: z.string().max(16),
  host: z.string().max(300),
  path: z.string().max(2000),
  resourceType: z.string().max(40),
  isDocument: z.boolean(),
  target: z.object({
    type: z.string().max(40),
    frameOrigin: z.string().max(400),
    topLevel: z.boolean(),
  }),
  party: z.enum(["target", "third"]),
  bodyKind: BodyKind,
  query: z.array(OutgoingValue).max(400),
  body: z.array(OutgoingValue).max(400),
  headers: z.array(OutgoingValue).max(100),
  bodyBytes: z.number().int().nonnegative(),
  bodyDigest: z.string().max(80),
  carries: z.array(CarriedField).max(16),
});
export type OutgoingRequest = z.infer<typeof OutgoingRequest>;

/** What a row that is not a request holds: a note about the run itself. */
export const GuardNote = z.object({ note: z.string().max(2000) });
export type GuardNote = z.infer<typeof GuardNote>;

export const SendRequest = z.union([OutgoingRequest, GuardNote]);
export type SendRequest = z.infer<typeof SendRequest>;

export function isOutgoingRequest(request: SendRequest): request is OutgoingRequest {
  return "method" in request;
}

/** A request an earlier run held and the person said may be sent, which a later run may spend once. */
export const ApprovedSend = z.object({
  id: z.string(),
  request: OutgoingRequest,
  /** The step already went out in the run that was held, and goes out again. */
  resend: z.boolean().default(false),
});
export type ApprovedSend = z.infer<typeof ApprovedSend>;

export const SubmitGateMode = z.enum(["hold", "record"]);
export type SubmitGateMode = z.infer<typeof SubmitGateMode>;

/**
 * What the outgoing gate does in a removal run. `hold` is for a model that has not passed the
 * safety gate: every send waits for a person. `record` is for a cleared model, which sends alone
 * but whose every send is logged before it leaves.
 */
export const SubmitGate = z.object({
  mode: SubmitGateMode,
  /** How long a held send waits for a person before the run gives up on it. */
  holdMs: z.number().int().nonnegative(),
  approved: z.array(ApprovedSend).default([]),
  declined: z.array(OutgoingRequest).default([]),
});
export type SubmitGate = z.infer<typeof SubmitGate>;

const MIN_TOKEN_LENGTH = 16;
const MIN_ENCODED_TOKEN_LENGTH = 24;
const MIN_TOKEN_ENTROPY = 3;

function entropyPerCharacter(text: string): number {
  const counts = new Map<string, number>();
  for (const character of text) counts.set(character, (counts.get(character) ?? 0) + 1);
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / text.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Whether a value looks like something a site generates for one page load: a CSRF token, a build
 * id or a nonce. Short values are never token-shaped, so a choice such as `scope=partners` can
 * not be passed off as one.
 */
export function isTokenShaped(value: string): boolean {
  if (/^[0-9a-f]{24,}$/i.test(value) || /^[A-Za-z0-9_-]{24,}$/.test(value)) {
    return value.length >= MIN_ENCODED_TOKEN_LENGTH && entropyPerCharacter(value) >= 2.5;
  }
  return value.length >= MIN_TOKEN_LENGTH && entropyPerCharacter(value) >= MIN_TOKEN_ENTROPY;
}

function valuesMatch(candidate: OutgoingValue, approved: OutgoingValue): boolean {
  if (!sameFields(candidate.fields, approved.fields)) return false;
  if (candidate.value === approved.value) return true;
  return (
    candidate.class === "served_token" &&
    approved.class === "served_token" &&
    isTokenShaped(candidate.value) &&
    isTokenShaped(approved.value)
  );
}

function sameFields(
  candidate: readonly CarriedField[] | undefined,
  approved: readonly CarriedField[] | undefined,
): boolean {
  const left = [...(candidate ?? [])].sort();
  const right = [...(approved ?? [])].sort();
  return left.length === right.length && left.every((field, index) => field === right[index]);
}

function sameValues(candidate: readonly OutgoingValue[], approved: readonly OutgoingValue[]) {
  if (candidate.length !== approved.length) return false;
  const byPath = new Map<string, OutgoingValue[]>();
  for (const value of approved) {
    byPath.set(value.path, [...(byPath.get(value.path) ?? []), value]);
  }
  for (const value of candidate) {
    const same = byPath.get(value.path);
    const expected = same?.shift();
    if (expected === undefined || !valuesMatch(value, expected)) return false;
  }
  return true;
}

/**
 * Whether a request is the one a person approved. Everything the person could have read must be
 * the same: the destination, the shape of the body, the names of its fields, the placeholders of
 * their values and every literal. Only a token the site generates for each page load may differ.
 * A body this program could not read never matches, because it can only be approved while held.
 */
export function matchesApproved(candidate: OutgoingRequest, approved: OutgoingRequest): boolean {
  if (candidate.bodyKind === "opaque" || approved.bodyKind === "opaque") return false;
  return sameRequestShape(candidate, approved);
}

/**
 * Whether a request is the very one that is paused and held right now. The body may be one this
 * program could not read, so the digest of its bytes stands in for reading it.
 */
export function matchesHeld(candidate: OutgoingRequest, held: OutgoingRequest): boolean {
  if (candidate.bodyDigest !== held.bodyDigest) return false;
  if (candidate.bodyKind === "opaque" || held.bodyKind === "opaque") {
    return candidate.bodyKind === held.bodyKind && sameRequestShape(candidate, held);
  }
  return sameRequestShape(candidate, held);
}

function sameRequestShape(candidate: OutgoingRequest, approved: OutgoingRequest): boolean {
  return (
    candidate.method.toUpperCase() === approved.method.toUpperCase() &&
    candidate.scheme === approved.scheme &&
    candidate.host === approved.host &&
    candidate.path === approved.path &&
    candidate.isDocument === approved.isDocument &&
    candidate.target.type === approved.target.type &&
    candidate.target.frameOrigin === approved.target.frameOrigin &&
    candidate.bodyKind === approved.bodyKind &&
    sameFields(candidate.carries, approved.carries) &&
    sameValues(candidate.query, approved.query) &&
    sameValues(candidate.body, approved.body) &&
    sameValues(candidate.headers, approved.headers)
  );
}

/** What a run's rows say about a send, in the order a person would ask. */
export const SEND_KINDS = ["lookup", "refused", "held", "released", "guard_event"] as const;
export const SendKind = z.enum(SEND_KINDS);
export type SendKind = z.infer<typeof SendKind>;

export const SEND_STATUSES = [
  "pending_live",
  "sent",
  "declined",
  "withdrawn",
  "awaiting_next_run",
  "approved_next_run",
  "spent",
  "unused",
  "releasing",
  "failed",
  "done",
] as const;
export const SendStatus = z.enum(SEND_STATUSES);
export type SendStatus = z.infer<typeof SendStatus>;

/** Reasons a request was refused outright, which the log and the model are told. */
export const REFUSAL_REASONS = [
  "third_party_value",
  "third_party_after_touch",
  "unreadable_body",
  "declined",
  "websocket",
  "unguarded_channel",
] as const;
