import type { ProfileField, ReplyClassification } from "@kickrocks/shared";
import type { InboxMessage } from "./types.js";

export interface Signal {
  classification: ReplyClassification;
  confidence: number;
  rationale: string;
  /** What gave the reading, or null when it came from a guess about the sender rather than from the message. */
  rule: ReadingId | null;
}

/** Readings that come from the headers of a message, not from what it says. */
export type StructuralId = "delivery-report" | "automatic-reply";
/** A reading that moves a request only when that request is waiting for it. */
export type WaitingId = "confirmation-link";
export type ReadingId = RuleId | StructuralId | WaitingId;

export type RuleId =
  | "identity-document"
  | "identity-unverified"
  | "more-information"
  | "email-not-accepted"
  | "use-online-form"
  | "must-use-other-channel"
  | "person-only"
  | "do-it-yourself"
  | "no-record"
  | "declined"
  | "has-been-done"
  | "we-have-done"
  | "provider-did-it"
  | "acknowledged";

/**
 * How a rule treats a negation or a condition before its match:
 * - `full`: any negation or condition in the clause, or "if" in the sentence, voids the match.
 * - `asking`: for rules that read a request, so "will" and "when" do not void "we will need a copy".
 * - `conditional`: only "if", "unless" or "whether" in the sentence voids it, for wording that is
 *   itself often written next to a refusal ("we cannot do it, so use the form").
 * - `ignore`: the rule describes something that has not happened yet, or its own wording is a negation.
 */
type NegationMode = "full" | "asking" | "conditional" | "ignore";

interface Rule {
  id: RuleId;
  classification: ReplyClassification;
  confidence: number;
  label: string;
  pattern: RegExp;
  negation?: NegationMode;
}

/** Words that, just before a phrase in the same sentence, turn "has been removed" into "has not". */
const NEGATION =
  /\b(not|never|no|unable|cannot|can't|couldn't|won't|unless|until|once|if|when|before|after|until|whether|will)\b|n't\b/i;
const ASKING_NEGATION =
  /\b(not|never|no|unable|cannot|can't|couldn't|won't|unless|if|whether)\b|n't\b/i;
/** A condition anywhere earlier in the sentence, even past a comma: "If you do not X, then Y". */
const CONDITION = /\b(if|unless|whether|in the event|in case(?! (?:no\.? ?|number |#)?\d))\b/i;

/** The words of the clause before a match, which is where a negation or a condition would sit. */
function sentenceBefore(text: string, index: number): string {
  const head = text.slice(Math.max(0, index - 60), index);
  const boundaries = [...head.matchAll(/[.!?;,\n]|\b(?:but|however)\b/gi)];
  const last = boundaries[boundaries.length - 1];
  return last ? head.slice(last.index + last[0].length) : head;
}

/** Everything from the start of the sentence up to a match. */
function sentenceHead(text: string, index: number): string {
  const head = text.slice(Math.max(0, index - 200), index);
  const boundaries = [...head.matchAll(/[.!?\n]/g)];
  const last = boundaries[boundaries.length - 1];
  return last ? head.slice(last.index + 1) : head;
}

function voided(rule: Rule, text: string, index: number): boolean {
  const mode = rule.negation ?? "full";
  if (mode === "ignore") return false;
  if (mode !== "asking" && CONDITION.test(sentenceHead(text, index))) return true;
  if (mode === "conditional") return false;
  const clause = sentenceBefore(text, index);
  return (mode === "asking" ? ASKING_NEGATION : NEGATION).test(clause);
}

export function firstMatch(rule: Rule, text: string): RegExpExecArray | null {
  const pattern = new RegExp(rule.pattern.source, `${rule.pattern.flags.replace("g", "")}g`);
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (!voided(rule, text, match.index)) return match;
    if (match[0] === "") pattern.lastIndex += 1;
  }
  return null;
}

/**
 * The places a company can name that are plainly somewhere to make a request: a form, a portal, a
 * request center, a ticket system. A bare address or phone number is not here because every
 * closing line that offers help carries one.
 */
const NAMED_CHANNEL = [
  `web ?forms?`,
  `(?:online|web|webform|privacy|request|opt[- ]?out|rights)[ -]?(?:forms?|portals?|cent(?:er|re)s?)`,
  `portals?`,
  `privacy request`,
  `one ?trust|trust ?arc|truste`,
  `tickets?(?: system)?`,
].join("|");

/**
 * Everything a company can say a request has to go through, including a phone line, the post or a
 * web address. It only counts next to wording that makes it a requirement ("must", "only"), where
 * mail is named as "postal mail" so a request to mail a copy of an ID is not taken for a redirect.
 */
const REQUIRED_CHANNEL = [
  NAMED_CHANNEL,
  `(?:data|support|help|consumer)[ -]?(?:forms?|portals?|cent(?:er|re)s?|pages?|sites?|websites?|desk)`,
  `(?:online|web|privacy|request|opt[- ]?out|rights)[ -]?(?:pages?|sites?|websites?|desk)`,
  `toll[- ]free`,
  `tele?phone`,
  `phone`,
  `calling`,
  `call(?: us| our| the| [a-z]+ at)?`,
  `(?:postal|regular|physical|snail) mail`,
  `by (?:post|letter)`,
  `https?://`,
  String.raw`www\.`,
  String.raw`\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}`,
].join("|");
const NO_STOP = `[^.!?]`;
/**
 * Like NO_STOP, but it cannot run through a verb that attaches something to a request or points at
 * an explanation, so "must include a signed form, as explained at https://..." does not read as a
 * place to send the request.
 */
const NOT_A_DESCRIPTION = String.raw`(?:(?!\b(?:includes?|including|accompan\w+|contains?|attach\w*|explain\w*|described?|detail\w*|outlined?|provide[sd]?)\b)[^.!?])`;

/** Words that ask the reader to hand something over, which is what separates a request for it from a description of it. */
const ASK_LEAD = `(?:please|kindly|must|(?:you|we|i)(?: will| would| may| must| should)? (?:need|require)s?(?: to)?|(?:is|are) required to|required to|requires?|submit|provide|send|upload|attach|supply|include|enclose|reply (?:to this e-?mail )?with)`;

const IDENTITY_DOCUMENT = [
  `proof of (?:your )?(?:identity|residen[ct]e)`,
  `(?:copy|photo(?:copy)?|scan|picture|image) of (?:your |a )?(?:valid |current |government[- ]issued )*(?:photo )?(?:id|identification|passport|driver'?s licen[sc]e)`,
  `photo id`,
  `government[- ]issued (?:photo )?(?:id|identification)`,
  `driver'?s licen[sc]e`,
  `(?:valid|current) (?:photo )?(?:id|identification)`,
].join("|");

/**
 * The person a company can insist on hearing from, as opposed to anyone asking for them. An
 * account holder is not here: a limit to the account is answered from the account's address, not
 * by asking again somewhere else.
 */
const THE_PERSON = `individual|person|consumer|data subject|owner`;

/**
 * Anyone asking for the person: a third party, an agent or a service, or someone acting on their
 * behalf. A third party named as an advertiser or vendor is a data recipient, not a requester.
 */
const SOMEONE_ELSE = [
  `(?:third|3rd)[- ]part(?:y|ies)(?! (?:advertisers?|vendors?|partners?|providers?|sites?|websites?|marketers?|data brokers?|companies|recipients?))`,
  `on (?:your|their|someone(?: else)?'s|another(?: person)?'s|a consumer's|a customer's) behalf`,
  `on behalf of (?:another|someone|others|other|a (?:third|consumer|customer|user)|individuals|consumers|customers|users|you)`,
  `(?:agents?|services?|companies|vendors?|representatives?) (?:acting|working|submitting|writing) (?:for|on behalf of)`,
].join("|");

/**
 * A company that will hear from an agent with permission is not refusing the messenger, only
 * asking for the paperwork, so a sentence that names the condition is left to the identity rules.
 */
const NOT_AN_AGENT_CONDITION = String.raw`(?![^.!?]*\b(?:authori[sz]ed (?:agents?|representatives?)|written (?:permission|authori[sz]ation|consent)|power of attorney|signed (?:permission|authori[sz]ation))\b)`;

const MORE_INFORMATION_FIELDS = String.raw`full name|date of birth|dob|address|phone number|zip|birth ?date|city(?![-\w.])|(?:direct |full )?(?:link|url)\b[^.\n]{0,40}\b(?:page|profile|listing|record)`;

/**
 * The wording rules, in no particular order. A rule's answer is applied without a person only when
 * its id is in PROVEN_RULES; every other answer is a suggestion that Review starts from.
 */
export const RULES: Rule[] = [
  {
    id: "identity-document",
    classification: "verification_required",
    confidence: 0.9,
    label: "asks for proof of identity",
    negation: "asking",
    pattern: new RegExp(
      [
        String.raw`\b${ASK_LEAD}\b[^.!?\n]{0,60}?\b(?:${IDENTITY_DOCUMENT})\b`,
        String.raw`\b${ASK_LEAD}\b[^.!?\n]{0,30}?\b(?:verify|confirm|validate|prove)\b[^.!?\n]{0,15}\byour identity\b`,
      ].join("|"),
      "i",
    ),
  },
  {
    id: "identity-unverified",
    classification: "verification_required",
    confidence: 0.85,
    label: "says the identity could not be verified",
    negation: "ignore",
    pattern:
      /\b(?:could not|couldn't|unable to|cannot|can't|were not able to|was not able to) (?:verify|confirm|validate) your identity\b/i,
  },
  {
    id: "more-information",
    classification: "verification_required",
    confidence: 0.8,
    label: "asks for more information",
    negation: "asking",
    pattern: new RegExp(
      [
        String.raw`\b(?:need|require|requires|requiring|requesting|(?:we|i) request)\b.{0,40}\b(?:additional|more|further|following)\b.{0,30}\b(?:information|details|identifiers)\b`,
        String.raw`\bplease (?:provide|send|supply|reply with)\b(?!.{0,80}\bto\s+\S*@).{0,80}\b(?:${MORE_INFORMATION_FIELDS})\b`,
        String.raw`\bplease confirm\b.{0,40}\b(?:full name|date of birth|dob|phone number|birth ?date|street address|home address|mailing address)\b`,
        String.raw`\bto (?:locate|find|verify|process) (?:your|the) (?:record|request|information).{0,80}\b(?:please|we need|provide)\b`,
        String.raw`\b(?:please|kindly)\b[^.!?]{0,40}\b(?:provide|send|supply|reply with|let us know)\b[^.!?]{0,40}\b(?:following|below) (?:information|details)\b`,
        String.raw`\byou (?:must|need to|have to) (?:submit|provide|send)\b[^.!?]{0,60}\b(?:identifiers?|documents?|information|details)\b`,
      ].join("|"),
      "i",
    ),
  },
  {
    id: "email-not-accepted",
    classification: "needs_form",
    confidence: 0.9,
    label: "points to a web form",
    negation: "ignore",
    pattern: new RegExp(
      [
        String.raw`\b(?:do not|don't|cannot|can't|unable to|no longer|only)\b.{0,30}\b(?:accept|process|handle|honou?r|take|receive)\b.{0,30}\b(?:requests?)?.{0,20}\b(?:by|via|through|over|using)\b.{0,10}\be-?mail\b`,
        String.raw`\brequests?\b${NO_STOP}{0,40}\b(?:must|can only|should) be (?:submitted|made|sent|filed)\b${NO_STOP}{0,30}\b(?:via|through|at|using|on) (?:(?:our|the|an?|this|its) )?(?:${REQUIRED_CHANNEL})`,
      ].join("|"),
      "i",
    ),
  },
  {
    id: "use-online-form",
    classification: "needs_form",
    confidence: 0.85,
    label: "asks to use an online form",
    negation: "full",
    pattern:
      /\bplease\b.{0,30}\b(use|submit|complete|visit|go to|fill out|fill in)\b.{0,30}\b(our|the|this)\b.{0,25}\b(?:(?:online |web |privacy |opt[- ]?out |request )*(?:form|portal|webform)|(?:request |opt[- ]?out )(?:page|center|centre))\b|\b(use|submit|complete|fill out) (our|the) (online |web )?(opt[- ]?out |privacy (request )?)?(form|portal)\b/i,
  },
  {
    id: "must-use-other-channel",
    classification: "needs_form",
    confidence: 0.9,
    label: "says requests must be made another way",
    negation: "ignore",
    pattern: new RegExp(
      [
        String.raw`\brequests?\b${NO_STOP}{0,60}\b(?:must|should|can only|may only|need to|have to|are required to|only)\b${NOT_A_DESCRIPTION}{0,60}\b(?:submitted|made|sent|filed|received|accepted|processed|through|via|by|at|using|on)\b${NO_STOP}{0,80}\b(?:${REQUIRED_CHANNEL})`,
        String.raw`\b(?:must|should|need to|have to|are required to|can only|may only|only)\b${NO_STOP}{0,40}\b(?:submit|make|send|file|lodge|exercise)\b${NO_STOP}{0,40}\b(?:requests?|submissions?)\b${NO_STOP}{0,80}\b(?:${REQUIRED_CHANNEL})`,
        String.raw`\bto (?:submit|make|file|exercise|start|initiate)\b${NO_STOP}{0,60}\b(?:requests?|rights)\b${NO_STOP}{0,100}\b(?:${NAMED_CHANNEL})`,
        String.raw`\b(?:please|kindly)\b${NO_STOP}{0,40}\b(?:use|submit|complete|visit|go to|fill|file|make|send|access|call|log ?in|open|create|raise)\b${NO_STOP}{0,60}\b(?:${NAMED_CHANNEL})`,
        String.raw`\be-?mail(?:ed)? requests\b${NO_STOP}{0,30}\b(?:not|cannot|can't)\b${NO_STOP}{0,30}\b(?:accepted|processed|honou?red|handled)\b`,
        String.raw`\b(?:can|may|will) only (?:act on|accept|process|honou?r) (?:[\w-]+ ){0,3}requests?(?: made| submitted)? (?:through|via|using)\b${NO_STOP}{0,30}\b(?:${REQUIRED_CHANNEL})`,
        String.raw`\baccept\b${NO_STOP}{0,60}\brequests? (?:through|via)\b${NO_STOP}{0,40}\b(?:${REQUIRED_CHANNEL})${NO_STOP}{0,30}\bonly\b`,
        String.raw`\be-?mail is not a (?:valid|accepted) way to (?:make|submit)\b`,
      ].join("|"),
      "i",
    ),
  },
  {
    id: "person-only",
    classification: "needs_form",
    confidence: 0.85,
    label: "says it only takes requests from the person",
    negation: "conditional",
    pattern: new RegExp(
      `${NOT_AN_AGENT_CONDITION}(?:${[
        String.raw`\b(?:do not|don't|does not|doesn't|cannot|can't|will not|won't|unable to|not able to|no longer|never)\b${NO_STOP}{0,40}\b(?:accept|process|honou?r|act on|handle|take|respond to|fulfil+)\b${NO_STOP}{0,30}\b(?:requests?|submissions?|opt[- ]?outs?|removals?|inquiries)\b${NO_STOP}{0,40}\b(?:${SOMEONE_ELSE})\b`,
        String.raw`\b(?:(?:${SOMEONE_ELSE})\b${NO_STOP}{0,10}\b(?:requests?|submissions?|opt[- ]?outs?)|requests?\b${NO_STOP}{0,20}\b(?:from|by|through|via|made by|submitted by)\b${NO_STOP}{0,10}\b(?:${SOMEONE_ELSE}))\b${NO_STOP}{0,30}\b(?:not|cannot|can't|won't|aren't|are not|is not|isn't)\b${NO_STOP}{0,30}\b(?:accepted|processed|honou?red|permitted|allowed|recogni[sz]ed|accept|process|honou?r)\b`,
        String.raw`\b(?:must|can only|may only|needs? to|has to|have to|should|will need to)\b${NO_STOP}{0,30}\b(?:be (?:submitted|made|sent|requested|received)|come|submit|request|make|contact us|reach out)\b${NO_STOP}{0,40}\b(?:directly )?(?:by|from)\b${NO_STOP}{0,10}\bthe (?:${THE_PERSON})\b`,
        String.raw`\b(?:can |may |will )?only (?:accept|process|honou?r|act on|respond to)\b${NO_STOP}{0,40}\brequests?\b${NO_STOP}{0,40}\b(?:directly )?(?:from|by|submitted by|sent by|made by) the (?:${THE_PERSON})\b`,
        String.raw`\bonly the (?:${THE_PERSON})\b${NO_STOP}{0,20}\b(?:may|can|is able to|should|must)\b${NO_STOP}{0,20}\b(?:submit|make|request|file|ask|contact)\b`,
        String.raw`\bhave the (?:${THE_PERSON})\b${NO_STOP}{0,30}\b(?:contact|reach out to|email|write to|submit)\b`,
      ].join("|")})`,
      "i",
    ),
  },
  {
    id: "do-it-yourself",
    classification: "needs_form",
    confidence: 0.85,
    label: "sends the person to do it themselves",
    negation: "conditional",
    pattern: new RegExp(
      [
        String.raw`\b(?:log ?in|sign in)\b${NO_STOP}{0,50}\b(?:delete|deactivate|remove|close)\b${NO_STOP}{0,30}\b(?:yourself|your (?:own )?account)\b`,
        String.raw`\b(?:delete|deactivate|remove|close) (?:it|your account|your data) yourself\b`,
        String.raw`\byou can (?:deactivate|delete|close|remove) your (?:account|profile)\b`,
        String.raw`\bfollowing the instructions (?:for|in|on) (?:your|the|our)\b`,
        String.raw`\b(?:you (?:should|must|need to|can|may|will need to)|please) (?:submit|file|complete|fill out) (?:an?|the) (?:new )?(?:[\w-]+ ){0,4}(?:form|webform)\b`,
      ].join("|"),
      "i",
    ),
  },
  {
    id: "no-record",
    classification: "no_record",
    confidence: 0.9,
    label: "says no record was found",
    negation: "ignore",
    pattern: new RegExp(
      [
        String.raw`\b(?:could not|couldn't|can not|cannot|unable to|did not|didn't|do not|don't|were not able to|was not able to)\b.{0,20}\b(?:find|locate|identify|match)\b(?![^.]{0,80}\bin an? (?:response|output|answer)\b).{0,60}\b(?:record|records|information|data|account|profile|listing|you|your|phone number|e-?mail(?: address)?|number)\b`,
        String.raw`\bno (?:matching |such |personal )?(?:record|records|data|information|account|profile|listing|match|matches|results?)\b.{0,30}\b(?:found|on file|exist|associated|located|matching)\b`,
        String.raw`\bwe (?:do not|don't) (?:have|hold|maintain|collect|keep|store|sell) any (?:personal )?(?:information|data|records?)\b`,
        String.raw`\b(?:do not|don't|does not|doesn't) (?:generally |currently )?(?:have|hold|maintain|keep|store) (?:any )?personal (?:information|data|records?)\b`,
      ].join("|"),
      "i",
    ),
  },
  {
    id: "declined",
    classification: "rejected",
    confidence: 0.85,
    label: "declines the request",
    negation: "ignore",
    pattern: new RegExp(
      [
        String.raw`\b(?:unable|not able|cannot|can't|will not|won't|are not required|do not have to)\b.{0,20}\b(?:process|honou?r|fulfil+|comply|complete|grant|accept)\b.{0,40}\b(?:your |this )?(?:request|opt[- ]?out|deletion)\b`,
        String.raw`\bwe (?:have )?(?:denied|declined|rejected)\b`,
        String.raw`\brequest (?:is |has been |was )?(?:processed and )?(?:denied|declined|rejected)\b`,
        String.raw`\b(?:not|no longer) (?:an? )?(?:[a-z]+ ){0,2}(?:resident|eligible|subject to)\b`,
        String.raw`\bexempt from\b`,
        String.raw`\b(?:unable|not able|cannot|can't|will not|won't)\b.{0,10}\b(?:delete|remove|erase)\b`,
        String.raw`\b(?:cannot|can't|unable to|not able to) take (?:any )?(?:further |additional )?action\b`,
        String.raw`\bnot (?:covered|subject) (?:under|by|to)\b`,
        String.raw`\bacts? as (?:the |a )?(?:data )?processor\b`,
      ].join("|"),
      "i",
    ),
  },
  {
    id: "has-been-done",
    classification: "completed",
    confidence: 0.9,
    label: "says the request is done",
    pattern:
      /\b(has|have) been (successfully |fully |permanently )?(removed|deleted|erased|suppressed|opted[- ]out|unsubscribed|completed|fulfil+ed|honou?red)\b/i,
  },
  {
    id: "we-have-done",
    classification: "completed",
    confidence: 0.8,
    label: "says the request is done",
    pattern:
      /\bwe (have|ve|'ve) (now )?(successfully |fully |permanently )?(removed|deleted|erased|suppressed|opted|unsubscribed|processed|completed|honou?red|fulfil+ed)\b(?!\s+(?:our|the|a|an)\s+(?:review|search|investigation|assessment))|\byou (have been|are now|will no longer be)\b.{0,20}\b(removed|opted[- ]out|unsubscribed|deleted)\b|\byour (request|opt[- ]?out|deletion request|data|information|record)s? (is|are|has been|have been) (now )?(complete|completed|fulfil+ed|deleted|removed)\b/i,
  },
  {
    id: "provider-did-it",
    classification: "completed",
    confidence: 0.8,
    label: "says the company has done it",
    pattern: new RegExp(
      [
        String.raw`\b(?:has|have) (?:now |successfully |fully )*(?:processed|completed|complied|honou?red|fulfil+ed)\b(?!\s+(?:our|the|a|an)\s+(?:review|search|investigation|assessment))[^.!?]{0,60}\b(?:request|opt[- ]?out|removal|deletion|data|information)\b`,
        String.raw`\bprocessed (?:the|your) request\b`,
        String.raw`\badded\b[^.!?]{0,80}\bsuppression list\b`,
      ].join("|"),
      "i",
    ),
  },
  {
    id: "acknowledged",
    classification: "auto_ack",
    confidence: 0.85,
    label: "acknowledges receipt",
    negation: "ignore",
    pattern:
      /\b(?:we|i)(?: have|'ve| just)? (?:received|got) your (?:request|message|e-?mail(?! address)|inquiry|enquiry|submission)\b|\byour (?:ticket|case) (?:has been|was) (?:created|opened|logged)\b|\b(?:will|shall) (?:respond|reply|get back|review|be in touch|process)\b/i,
  },
];

/**
 * The wording rules whose answer is applied without a person. A rule joins only after fresh mail
 * from the product's own inbox shows at least 95% precision with real support: about 60 correct
 * decisions in a row put the 95% Wilson lower bound at 95%. No rule has that yet. The best
 * three were right on 4, 4 and 4 of the real labeled replies, which bounds each at about 51% to
 * 57%, and parts of them never fired on real mail, so every wording rule only suggests.
 * The counts are in docs/reply-classifier.md.
 */
export const PROVEN_RULES: ReadonlySet<RuleId> = new Set<RuleId>([]);

/**
 * Readings from the headers of a message rather than its words. The real replies carry no
 * headers, so they could not measure these; they apply behind the sender trust checks, which a
 * delivery report must still pass.
 */
export const STRUCTURAL_READINGS: ReadonlySet<StructuralId> = new Set<StructuralId>([
  "delivery-report",
  "automatic-reply",
]);

/**
 * Readings that apply only for a request that is waiting for them. A confirmation link is
 * followed because a form the system submitted is waiting for exactly that mail. Its wording was
 * never measured, so with no waiting form it only suggests.
 */
export const WAITING_READINGS: ReadonlySet<WaitingId> = new Set<WaitingId>(["confirmation-link"]);

export function appliesWithoutPerson(
  reading: ReadingId | null,
  { waiting = false }: { waiting?: boolean } = {},
): boolean {
  if (reading === null) return false;
  if (WAITING_READINGS.has(reading as WaitingId)) return waiting;
  return PROVEN_RULES.has(reading as RuleId) || STRUCTURAL_READINGS.has(reading as StructuralId);
}

const OUT_OF_OFFICE =
  /\b(out of (the )?office|automatic reply|auto[- ]?reply|autoreply|on (annual )?leave|on vacation|away from (my|the) (desk|office)|i am currently (away|out))\b/i;

const DELAY_NOTICE =
  /\b(delivery status notification \(delay\)|delivery (is )?delayed|message (has been )?delayed|will (continue|keep) (to )?(try|trying)|still trying to deliver)\b/i;

const BOUNCE_SUBJECT =
  /\b(undeliverable|undelivered mail|delivery status notification|mail delivery (failed|failure|subsystem)|returned mail|delivery failure|failure notice|could not be delivered|message not delivered|address not found)\b/i;

/** Bulk and junk mail is sent to many people, so it is not an automatic reply to this one. */
const AUTO_PRECEDENCE = /^(auto_reply|auto-reply)$/i;

/**
 * Which kind of mail wins when two rules match with the same strength. A redirect comes after a
 * finished, missing or confirmable request because it is the loosest wording of them.
 */
export const CLASS_PRIORITY: readonly ReplyClassification[] = [
  "bounce",
  "verification_required",
  "no_record",
  "completed",
  "confirmation_link",
  "needs_form",
  "rejected",
  "auto_ack",
  "unknown",
  "unrelated",
];

/** The parts of a message the rules read, so a stored reply can be judged without rebuilding the whole mail. */
export type RuleMessage = Pick<
  InboxMessage,
  "subject" | "from" | "isBounce" | "autoSubmitted" | "headers"
>;

interface RuleInput {
  message: RuleMessage;
  /** What the sender wrote, without the quoted request. */
  body: string;
}

function redirectsElsewhere(text: string): boolean {
  return RULES.some((rule) => rule.classification === "needs_form" && firstMatch(rule, text));
}

const ASKS: readonly ReplyClassification[] = ["verification_required", "needs_form"];
const REFUSALS: readonly ReplyClassification[] = ["no_record", "rejected"];

function byStrength(a: Signal, b: Signal): number {
  return (
    b.confidence - a.confidence ||
    CLASS_PRIORITY.indexOf(a.classification) - CLASS_PRIORITY.indexOf(b.classification)
  );
}

/**
 * Strongest first, except that a request or a route outranks a missing or refused record that
 * comes with it ("we found nothing, send the link"), and a finished request outranks a missing
 * one ("deleted for the email, nothing for the phone"). The statement of an outcome is often the
 * reason for the ask, so the ask is what the person has to act on.
 */
export function sortSignals(signals: Signal[]): Signal[] {
  signals.sort(byStrength);
  const lift = (classes: readonly ReplyClassification[]) => {
    const index = signals.findIndex((signal) => classes.includes(signal.classification));
    if (index > 0) signals.unshift(...signals.splice(index, 1));
  };
  const refused = (signal: Signal | undefined) =>
    signal !== undefined && REFUSALS.includes(signal.classification);
  if (refused(signals[0])) lift(ASKS);
  if (refused(signals[0])) lift(["completed"]);
  return signals;
}

/** Every signal the wording and headers give, strongest first. Bounces and out-of-office replies end the search. */
export function matchSignals({ message, body }: RuleInput): Signal[] {
  const subject = message.subject;
  const text = `${subject}\n${body}`;

  if (DELAY_NOTICE.test(text) && (message.isBounce || BOUNCE_SUBJECT.test(subject))) {
    return [
      {
        classification: "auto_ack",
        confidence: 0.75,
        rationale: "A delivery delay notice, not a failure",
        rule: message.isBounce ? "automatic-reply" : null,
      },
    ];
  }
  if (message.isBounce) {
    return [
      {
        classification: "bounce",
        confidence: 0.97,
        rationale: "A delivery status report from a mail server",
        rule: "delivery-report",
      },
    ];
  }
  if (
    BOUNCE_SUBJECT.test(subject) &&
    /mailer-daemon|postmaster|mail delivery|mail-daemon/i.test(
      `${message.from.address} ${message.from.name ?? ""}`,
    )
  ) {
    return [
      {
        classification: "bounce",
        confidence: 0.9,
        rationale: "A mail server reported that delivery failed",
        rule: "delivery-report",
      },
    ];
  }
  // A company's canned auto-reply is often the redirect itself, so an out-of-office notice only
  // ends the search when nothing in it sends the request somewhere else.
  if (
    (OUT_OF_OFFICE.test(subject) ||
      (message.autoSubmitted && OUT_OF_OFFICE.test(body.slice(0, 600)))) &&
    !redirectsElsewhere(text)
  ) {
    return [
      {
        classification: "auto_ack",
        confidence: 0.9,
        rationale: "An out-of-office or automatic reply",
        // The subject alone is wording; only the machine-sent header makes it a structural reading.
        rule: message.autoSubmitted ? "automatic-reply" : null,
      },
    ];
  }

  const signals: Signal[] = [];
  for (const rule of RULES) {
    if (firstMatch(rule, text)) {
      signals.push({
        classification: rule.classification,
        confidence: rule.confidence,
        rationale: `The reply ${rule.label}`,
        rule: rule.id,
      });
    }
  }

  // A thank-you or an acknowledgement does not make a reply an acknowledgement when it goes on to
  // say the request has to be made somewhere else.
  const redirects = signals.some((signal) => signal.classification === "needs_form");
  if (redirects) {
    signals.splice(0, signals.length, ...signals.filter((s) => s.classification !== "auto_ack"));
  }

  const precedence = message.headers.precedence ?? "";
  const machine =
    message.autoSubmitted ||
    "x-autoreply" in message.headers ||
    AUTO_PRECEDENCE.test(precedence.trim());
  if (machine && !redirects && !signals.some((signal) => signal.classification === "auto_ack")) {
    signals.push({
      classification: "auto_ack",
      confidence: 0.7,
      rationale: "Sent automatically, with no sign of a decision",
      rule: null,
    });
  }

  return sortSignals(signals);
}

interface FieldRule {
  field: ProfileField;
  pattern: RegExp;
}

const ASKING =
  /\b(please|provide|send|submit|supply|include|reply with|need|needs|require|requires|required|verify|confirm|attach|furnish|share|tell us|let us know|must)\b/i;

const FIELD_RULES: FieldRule[] = [
  { field: "full_name", pattern: /\b(full|legal|complete) name\b|\byour name\b/i },
  { field: "first_name", pattern: /\bfirst name\b/i },
  { field: "last_name", pattern: /\b(last|sur|family) ?name\b/i },
  {
    field: "email",
    pattern:
      /\b(your|registered|associated|primary|current|account|alternate) e-?mail( address(es)?)?\b|\be-?mail address(es)? (you|used|associated|on file)\b/i,
  },
  { field: "phone", pattern: /\b(phone|telephone|mobile|cell)( number)?\b/i },
  { field: "city", pattern: /\b(city|town)\b(?![-.]\w)/i },
  {
    field: "state",
    pattern:
      /\b(state of residence|which state|state and zip|city and state|city, state|state\/province)\b/i,
  },
  { field: "zip", pattern: /\bzip( code)?\b|\bpostal code\b|\bpostcode\b/i },
  {
    field: "street",
    pattern:
      /\b(street|home|mailing|physical|residential|postal|current|previous|full) address\b|\bstreet\b/i,
  },
  { field: "birth_year", pattern: /\b(year of birth|birth year|birthyear)\b/i },
  { field: "date_of_birth", pattern: /\bdate of birth\b|\bdob\b|\bbirth ?date\b|\bbirthday\b/i },
  {
    field: "record_url",
    pattern:
      /\b(url|link|web ?address)\b.{0,40}\b(profile|listing|record|page)\b|\b(profile|listing|record) (url|link)\b/i,
  },
];

/**
 * The profile fields a broker asks for, by name. Only paragraphs that ask for something are read,
 * because "we already have your date of birth" is not a request for it, and a bulleted list that
 * follows a line ending in a colon counts as part of that request.
 */
export function requestedFieldsIn(body: string): ProfileField[] {
  const blocks = body.split(/\n\s*\n/);
  const asked: string[] = [];
  blocks.forEach((block, index) => {
    const previous = blocks[index - 1] ?? "";
    if (ASKING.test(block) || (previous.trimEnd().endsWith(":") && ASKING.test(previous))) {
      asked.push(block);
    }
  });
  const text = asked.join("\n");
  const fields = FIELD_RULES.filter(({ pattern }) => pattern.test(text)).map(({ field }) => field);
  return fields.includes("full_name")
    ? fields.filter((field) => field !== "first_name" && field !== "last_name")
    : fields;
}
