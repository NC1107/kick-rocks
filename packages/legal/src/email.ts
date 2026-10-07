import {
  type LegalBasis,
  POLICY_RESPONSE_DAYS,
  type ProfileField,
  type ProfileFields,
  Reference,
  type RenderedEmail,
  RequestRight,
  type Statute,
  stateName,
} from "@kickrocks/shared";
import { z } from "zod";
import { LegalInputError } from "./errors.js";
import { splitRights, traitsOf } from "./statutes.js";
import type { LegalApi, RenderRequestEmailInput } from "./types.js";

const FIELD_LABELS: Record<ProfileField, string> = {
  full_name: "Name",
  first_name: "First name",
  last_name: "Last name",
  email: "Email",
  phone: "Phone",
  street: "Street address",
  city: "City",
  state: "State",
  zip: "ZIP code",
  birth_year: "Year of birth",
  date_of_birth: "Date of birth",
  record_url: "Listing URL",
};

const FIELD_ORDER = Object.keys(FIELD_LABELS) as ProfileField[];

const Input = z.object({
  kind: z.enum(["initial", "follow_up", "verification_reply"]),
  rights: z.array(RequestRight).min(1),
  reference: Reference,
  sender: z.object({ name: z.string().trim().min(1), address: z.email() }),
  target: z.object({ name: z.string().trim().min(1) }).loose(),
});

const oneLine = (value: string): string => value.replace(/\s+/g, " ").trim();

function orderedRights(rights: readonly RequestRight[]): RequestRight[] {
  return RequestRight.options.filter((right) => rights.includes(right));
}

function requestTitle(rights: readonly RequestRight[]): string {
  if (rights.length === 2) return "Opt-out and deletion request";
  return rights[0] === "opt_out" ? "Opt-out request" : "Deletion request";
}

function askLines(rights: readonly RequestRight[]): string[] {
  const asks: Record<RequestRight, string> = {
    opt_out: "stop selling or sharing my personal information",
    delete: "delete the personal information you hold about me",
  };
  if (rights.length === 1) {
    return [`I ask you to ${asks[rights[0] as RequestRight]}.`];
  }
  return ["I ask you to:", ...rights.map((right) => `- ${asks[right]}`)];
}

const POLICY_COMMITMENTS = "your own published privacy commitments";
const CHANNEL_REQUEST =
  "If your privacy notice requires another way to submit this, tell me which.";

function rightPhrase(rights: readonly RequestRight[], statute: Statute): string {
  const deleteWording =
    traitsOf(statute.id).deleteScope === "provided"
      ? "have the personal information I provided to you deleted"
      : "have my personal information deleted";
  const phrases: Record<RequestRight, string> = {
    opt_out: "opt out of the sale of my personal information",
    delete: deleteWording,
  };
  return rights.map((right) => phrases[right]).join(" and to ");
}

/** The Delete Act binds registered brokers to DROP, so the person has no right to demand an email answer. */
function isPlatformStatute(statute: Statute): boolean {
  return statute.kind === "data_broker" && statute.platform !== null;
}

function statuteIntro(basis: LegalBasis, statute: Statute, covered: RequestRight[]): string {
  const opening = `I live in ${stateName(basis.state)}.`;
  const closing =
    "I ask you to honor this request under that law, to the extent it applies to you.";
  if (isPlatformStatute(statute)) {
    return `${opening} Under the ${statute.name} (${statute.citation}), a data broker registered with the state must process consumer deletion requests. ${closing}`;
  }
  return `${opening} Under the ${statute.name} (${statute.citation}), I have the right to ${rightPhrase(covered, statute)}. ${closing}`;
}

/** The sentences that say why the request is owed an answer, from the stored basis only. */
function basisLines(
  basis: LegalBasis,
  rights: readonly RequestRight[],
  targetKind: "broker" | "company",
  followUp: boolean,
  channel: boolean,
): string[] {
  if (basis.kind === "statute" && basis.statute === null) {
    throw new LegalInputError("A statute basis must carry its statute");
  }
  const statute = basis.statute;
  const policy = `I ask you to honor it under ${POLICY_COMMITMENTS}. If your privacy policy names a different way to submit it, tell me and I will use it.`;
  if (basis.kind === "policy" || statute === null) {
    return [followUp ? `I asked you to honor it under ${POLICY_COMMITMENTS}.` : policy];
  }

  const { covered, uncovered } = splitRights(statute, rights, targetKind);
  const lines = [
    followUp
      ? `I made this request under the ${statute.name} (${statute.citation}), to the extent it applies to you.`
      : statuteIntro(basis, statute, covered),
  ];
  if (uncovered.length > 0) {
    lines.push(
      `That law does not cover everything I ask, so for the rest I ask you to honor it under ${POLICY_COMMITMENTS}.`,
    );
  }
  if (channel) lines.push(CHANNEL_REQUEST);
  return lines;
}

function responseLine(basis: LegalBasis, rights: readonly RequestRight[]): string {
  const statute = basis.statute;
  const businessDays = statute ? traitsOf(statute.id).optOutBusinessDays : null;
  if (businessDays !== null && rights.every((right) => right === "opt_out")) {
    return `Please stop selling and sharing my personal information as soon as feasible, no later than ${businessDays} business days after you receive this email, and confirm in writing.`;
  }
  const days = basis.kind === "statute" ? basis.responseDays : POLICY_RESPONSE_DAYS;
  const base = `Please confirm in writing within ${days} days of receiving this email.`;
  if (statute && statute.extensionDays > 0) {
    return `${base} If you need the extra time the law allows, tell me inside that period and say why.`;
  }
  return base;
}

function detailLines(
  identifiers: ProfileFields,
  sender: { name: string; address: string },
  highlight: ReadonlySet<ProfileField>,
): string[] {
  const values: ProfileFields = { ...identifiers };
  if (Object.keys(values).length === 0) {
    values.full_name = sender.name;
    values.email = sender.address;
  }
  const ordered = FIELD_ORDER.filter((field) => values[field] !== undefined);
  const lines = (fields: ProfileField[]) =>
    fields.map((field) => `${FIELD_LABELS[field]}: ${oneLine(values[field] as string)}`);
  const requested = ordered.filter((field) => highlight.has(field));
  const rest = ordered.filter((field) => !highlight.has(field));
  return [...lines(requested), ...lines(rest)];
}

const OPT_OUT_ID_ASK = "Please do not ask for ID, an account, or a fee to stop selling my data.";

function optOutAuthLine(
  basis: LegalBasis,
  rights: readonly RequestRight[],
  targetKind: "broker" | "company",
): string {
  const statute = basis.statute;
  const rule =
    statute !== null && splitRights(statute, rights, targetKind).covered.includes("opt_out")
      ? traitsOf(statute.id).optOutAuthRule
      : null;
  if (rule === null) return OPT_OUT_ID_ASK;
  return `Under ${rule}, an opt-out of sale does not have to be authenticated. ${OPT_OUT_ID_ASK} If you need a detail to find my record, tell me which one.`;
}

function verificationLines(
  basis: LegalBasis,
  rights: readonly RequestRight[],
  targetKind: "broker" | "company",
): string[] {
  const lines: string[] = [];
  if (rights.includes("opt_out")) lines.push(optOutAuthLine(basis, rights, targetKind));
  if (rights.includes("delete")) {
    lines.push(
      "If you need to verify me before deleting, tell me which detail you need and why. I will decide whether to send it.",
    );
  }
  return lines;
}

function sentOn(originalSentAt: string): string {
  const time = Date.parse(originalSentAt);
  if (Number.isNaN(time)) {
    throw new LegalInputError(`followUp.originalSentAt is not a date: ${originalSentAt}`);
  }
  return new Date(time).toISOString().slice(0, 10);
}

function greeting(targetName: string): string {
  return `Hello ${oneLine(targetName)} privacy team,`;
}

function signature(sender: { name: string; address: string }): string[] {
  return ["Thank you,", oneLine(sender.name), sender.address];
}

function initialBody(input: RenderRequestEmailInput, rights: RequestRight[]): string[] {
  return [
    greeting(input.target.name),
    "",
    ...askLines(rights),
    "",
    ...basisLines(input.basis, rights, input.target.kind, false, true),
    "",
    "Details to find my records:",
    ...detailLines(input.identifiers, input.sender, new Set()),
    "",
    ...verificationLines(input.basis, rights, input.target.kind),
    "",
    responseLine(input.basis, rights),
    `Please keep ${input.reference} in the subject of your reply so I can match it.`,
    "",
    ...signature(input.sender),
  ];
}

function requireFollowUp(input: RenderRequestEmailInput): { number: number; sentOn: string } {
  const { followUp } = input;
  if (!followUp) throw new LegalInputError("A follow-up email needs followUp details");
  if (!Number.isInteger(followUp.number) || followUp.number < 1) {
    throw new LegalInputError("followUp.number must be a whole number of at least 1");
  }
  return { number: followUp.number, sentOn: sentOn(followUp.originalSentAt) };
}

function followUpBody(
  input: RenderRequestEmailInput,
  rights: RequestRight[],
  followUp: { number: number; sentOn: string },
): string[] {
  return [
    greeting(input.target.name),
    "",
    `On ${followUp.sentOn} I sent you a request, reference ${input.reference}. I have not received a response. This is follow-up ${followUp.number}.`,
    "",
    ...askLines(rights),
    "",
    ...basisLines(input.basis, rights, input.target.kind, true, false),
    "",
    "Details to find my records:",
    ...detailLines(input.identifiers, input.sender, new Set()),
    "",
    "Please confirm in writing what you have done. If you already replied and I missed it, please send it again. If this request must go through a different channel, tell me which.",
    `Please keep ${input.reference} in the subject of your reply so I can match it.`,
    "",
    ...signature(input.sender),
  ];
}

function verificationBody(input: RenderRequestEmailInput, rights: RequestRight[]): string[] {
  const requested = input.verification?.requestedFields;
  if (!requested || requested.length === 0) {
    throw new LegalInputError("A verification reply needs the fields the broker asked for");
  }
  const missing = requested.filter((field) => input.identifiers[field] === undefined);
  if (missing.length > 0) {
    throw new LegalInputError(
      `A verification reply cannot answer for fields with no value: ${missing.join(", ")}`,
    );
  }
  return [
    greeting(input.target.name),
    "",
    `Thank you for your reply about request ${input.reference}. You asked for more information to process it. Here it is:`,
    ...detailLines(input.identifiers, input.sender, new Set(requested)),
    "",
    "Please use these details only to find and process this request, and for no other purpose.",
    "",
    ...askLines(rights),
    "",
    ...basisLines(input.basis, rights, input.target.kind, true, false),
    "",
    `Please confirm in writing when it is done, and keep ${input.reference} in the subject of your reply.`,
    "",
    ...signature(input.sender),
  ];
}

export const renderRequestEmail: LegalApi["renderRequestEmail"] = (input): RenderedEmail => {
  const parsed = Input.safeParse(input);
  if (!parsed.success) {
    throw new LegalInputError(`Cannot render the email: ${z.prettifyError(parsed.error)}`);
  }
  const rights = orderedRights(parsed.data.rights);
  const title = requestTitle(rights);
  const reference = parsed.data.reference;

  switch (parsed.data.kind) {
    case "initial":
      return {
        subject: `${title} (${reference})`,
        text: `${initialBody(input, rights).join("\n")}\n`,
      };
    case "follow_up": {
      const followUp = requireFollowUp(input);
      return {
        subject: `Follow-up ${followUp.number}: ${title} (${reference})`,
        text: `${followUpBody(input, rights, followUp).join("\n")}\n`,
      };
    }
    case "verification_reply":
      return {
        subject: `Re: ${title} (${reference})`,
        text: `${verificationBody(input, rights).join("\n")}\n`,
      };
  }
};
