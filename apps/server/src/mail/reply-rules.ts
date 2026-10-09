import type { ProfileField, ReplyClassification } from "@kickrocks/shared";
import type { InboxMessage } from "./types.js";

export interface Signal {
  classification: ReplyClassification;
  confidence: number;
  rationale: string;
}

interface Rule {
  classification: ReplyClassification;
  confidence: number;
  label: string;
  pattern: RegExp;
  /** The rule describes a state that has not happened yet or is conditional, so a negation does not apply. */
  ignoreNegation?: boolean;
}

/** Words that, just before a phrase in the same sentence, turn "has been removed" into "has not". */
const NEGATION =
  /\b(not|never|no|unable|cannot|can't|couldn't|won't|unless|until|once|if|when|before|after|until|whether|will)\b|n't\b/i;

/** The words of the clause before a match, which is where a negation or a condition would sit. */
function sentenceBefore(text: string, index: number): string {
  const head = text.slice(Math.max(0, index - 60), index);
  const boundaries = [...head.matchAll(/[.!?;,\n]|\b(?:but|however)\b/gi)];
  const last = boundaries[boundaries.length - 1];
  return last ? head.slice(last.index + last[0].length) : head;
}

function firstMatch(rule: Rule, text: string): RegExpExecArray | null {
  const pattern = new RegExp(rule.pattern.source, `${rule.pattern.flags.replace("g", "")}g`);
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (rule.ignoreNegation || !NEGATION.test(sentenceBefore(text, match.index))) return match;
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

const RULES: Rule[] = [
  {
    classification: "verification_required",
    confidence: 0.9,
    label: "asks to verify identity",
    ignoreNegation: true,
    pattern:
      /\b(verify|confirm|prove|validate)\b.{0,30}\b(your )?identity\b|\bproof of (your )?(identity|residen[ct]e)\b|\bidentity verification\b|\b(government|state)[- ]issued\b|\bdriver'?s licen[sc]e\b|\bcopy of (your )?(id|identification|passport)\b|\bphoto id\b/i,
  },
  {
    classification: "verification_required",
    confidence: 0.8,
    label: "asks for more information",
    ignoreNegation: true,
    pattern:
      /\b(need|require|requires|requiring|request|requesting)\b.{0,40}\b(additional|more|further|following)\b.{0,30}\b(information|details|identifiers)\b|\bplease (provide|send|supply|reply with)\b.{0,80}\b(full name|date of birth|dob|address|phone number|zip|birth ?date|city)\b|\bplease confirm\b.{0,40}\b(full name|date of birth|dob|phone number|birth ?date|street address|home address|mailing address)\b|\bto (locate|find|verify|process) (your|the) (record|request|information).{0,80}\b(please|we need|provide)\b/i,
  },
  {
    classification: "needs_form",
    confidence: 0.9,
    label: "points to a web form",
    ignoreNegation: true,
    pattern:
      /\b(do not|don't|cannot|can't|unable to|no longer|only)\b.{0,30}\b(accept|process|handle|honou?r|take|receive)\b.{0,30}\b(request|requests)?.{0,20}\b(by|via|through|over|using)\b.{0,10}\be-?mail\b|\brequests?\b.{0,40}\b(must|can only|should) be (submitted|made|sent|filed)\b.{0,30}\b(via|through|at|using|on)\b/i,
  },
  {
    classification: "needs_form",
    confidence: 0.85,
    label: "asks to use an online form",
    ignoreNegation: true,
    pattern:
      /\bplease\b.{0,30}\b(use|submit|complete|visit|go to|fill out|fill in)\b.{0,30}\b(our|the|this)\b.{0,25}\b(?:(?:online |web |privacy |opt[- ]?out |request )*(?:form|portal|webform)|(?:request |opt[- ]?out )(?:page|center|centre))\b|\b(use|submit|complete|fill out) (our|the) (online |web )?(opt[- ]?out |privacy (request )?)?(form|portal)\b/i,
  },
  {
    classification: "needs_form",
    confidence: 0.9,
    label: "says requests must be made another way",
    ignoreNegation: true,
    pattern: new RegExp(
      [
        String.raw`\brequests?\b${NO_STOP}{0,60}\b(?:must|should|can only|may only|need to|have to|are required to|only)\b${NO_STOP}{0,60}\b(?:submitted|made|sent|filed|received|accepted|processed|through|via|by|at|using|on)\b${NO_STOP}{0,80}\b(?:${REQUIRED_CHANNEL})`,
        String.raw`\b(?:must|should|need to|have to|are required to|can only|may only|only)\b${NO_STOP}{0,40}\b(?:submit|make|send|file|lodge|exercise)\b${NO_STOP}{0,40}\b(?:requests?|submissions?)\b${NO_STOP}{0,80}\b(?:${REQUIRED_CHANNEL})`,
        String.raw`\bto (?:submit|make|file|exercise|start|initiate)\b${NO_STOP}{0,60}\b(?:requests?|rights)\b${NO_STOP}{0,100}\b(?:${NAMED_CHANNEL})`,
        String.raw`\b(?:please|kindly)\b${NO_STOP}{0,40}\b(?:use|submit|complete|visit|go to|fill|file|make|send|access|call|log ?in|open|create|raise)\b${NO_STOP}{0,60}\b(?:${NAMED_CHANNEL})`,
        String.raw`\be-?mail(?:ed)? requests\b${NO_STOP}{0,30}\b(?:not|cannot|can't)\b${NO_STOP}{0,30}\b(?:accepted|processed|honou?red|handled)\b`,
      ].join("|"),
      "i",
    ),
  },
  {
    classification: "no_record",
    confidence: 0.9,
    label: "says no record was found",
    ignoreNegation: true,
    pattern:
      /\b(could not|couldn't|can not|cannot|unable to|did not|didn't|do not|don't|were not able to|was not able to)\b.{0,20}\b(find|locate|identify|match)\b.{0,60}\b(record|records|information|data|account|profile|listing|you|your)\b|\bno (matching |such |personal )?(record|records|data|information|account|profile|listing|match|matches|results?)\b.{0,30}\b(found|on file|exist|associated|located|matching)\b|\bwe (do not|don't) (have|hold|maintain|collect|keep|store|sell) any (personal )?(information|data|records?)\b/i,
  },
  {
    classification: "rejected",
    confidence: 0.85,
    label: "declines the request",
    ignoreNegation: true,
    pattern:
      /\b(unable|not able|cannot|can't|will not|won't|are not required|do not have to)\b.{0,20}\b(process|honou?r|fulfil+|comply|complete|grant|accept)\b.{0,40}\b(your |this )?(request|opt[- ]?out|deletion)\b|\bwe (have )?(denied|declined|rejected)\b|\brequest (is |has been |was )?(denied|declined|rejected)\b|\b(not|no longer) (a )?(resident|eligible|subject to)\b|\bexempt from\b/i,
  },
  {
    classification: "completed",
    confidence: 0.9,
    label: "says the request is done",
    pattern:
      /\b(has|have) been (successfully |fully |permanently )?(removed|deleted|erased|suppressed|opted[- ]out|unsubscribed|processed|completed|fulfil+ed|honou?red)\b/i,
  },
  {
    classification: "completed",
    confidence: 0.8,
    label: "says the request is done",
    pattern:
      /\bwe (have|ve|'ve) (now )?(successfully |fully |permanently )?(removed|deleted|erased|suppressed|opted|unsubscribed|processed|completed|honou?red|fulfil+ed)\b|\byou (have been|are now|will no longer be)\b.{0,20}\b(removed|opted[- ]out|unsubscribed|deleted)\b|\byour (request|opt[- ]?out|deletion request|data|information|record)s? (is|are|has been|have been) (now )?(complete|completed|fulfil+ed|processed|deleted|removed)\b/i,
  },
  {
    classification: "auto_ack",
    confidence: 0.85,
    label: "acknowledges receipt",
    ignoreNegation: true,
    pattern:
      /\b(we|i)( have|'ve|'ve| just)? (received|got) your (request|message|e-?mail|inquiry|enquiry|submission)\b|\bthank you for (contacting|submitting|reaching out|your (request|submission|e-?mail|message|inquiry))\b|\b(ticket|case|request|reference) (number|id|no\.?|#)\b|\byour (ticket|case) (has been|was) (created|opened|logged)\b|\b(will|shall) (respond|reply|get back|review|be in touch|process)\b|\bwithin \d+ (business |working |calendar )?(days|hours)\b/i,
  },
];

const OUT_OF_OFFICE =
  /\b(out of (the )?office|automatic reply|auto[- ]?reply|autoreply|on (annual )?leave|on vacation|away from (my|the) (desk|office)|i am currently (away|out))\b/i;

const DELAY_NOTICE =
  /\b(delivery status notification \(delay\)|delivery (is )?delayed|message (has been )?delayed|will (continue|keep) (to )?(try|trying)|still trying to deliver)\b/i;

const BOUNCE_SUBJECT =
  /\b(undeliverable|undelivered mail|delivery status notification|mail delivery (failed|failure|subsystem)|returned mail|delivery failure|failure notice|could not be delivered|message not delivered|address not found)\b/i;

const AUTO_PRECEDENCE = /^(auto_reply|auto-reply|bulk|junk)$/i;

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

interface RuleInput {
  message: InboxMessage;
  /** What the sender wrote, without the quoted request. */
  body: string;
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
      },
    ];
  }
  if (message.isBounce) {
    return [
      {
        classification: "bounce",
        confidence: 0.97,
        rationale: "A delivery status report from a mail server",
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
      },
    ];
  }
  if (
    OUT_OF_OFFICE.test(subject) ||
    (message.autoSubmitted && OUT_OF_OFFICE.test(body.slice(0, 600)))
  ) {
    return [
      {
        classification: "auto_ack",
        confidence: 0.9,
        rationale: "An out-of-office or automatic reply",
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
    });
  }

  return signals.sort(
    (a, b) =>
      b.confidence - a.confidence ||
      CLASS_PRIORITY.indexOf(a.classification) - CLASS_PRIORITY.indexOf(b.classification),
  );
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
  { field: "city", pattern: /\b(city|town)\b/i },
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
