import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReplyClassification } from "@kickrocks/shared";
import { dkimSign } from "mailauth";
import type { MessageLabel, Outcome } from "./corpus.js";
import {
  AMAZON_ACCOUNT_SUBJECTS,
  AMAZON_MARKETING_SUBJECTS,
  BANK_BODIES,
  BANKS,
  BOUNCE_REASONS,
  BROKER_MARKETING_SUBJECTS,
  CALENDAR_EVENTS,
  CLEAR_NO_REFERENCE,
  digits,
  FIRST_LINE_GREETINGS,
  FIRST_NAMES,
  hex,
  ITEMS,
  int,
  NETFLIX_ACCOUNT_SUBJECTS,
  NETFLIX_MARKETING_SUBJECTS,
  NEWSLETTERS,
  NO_REQUEST_TARGETS,
  ORDER_SUBJECTS,
  OTHER_MARKETING,
  OUT_OF_OFFICE,
  PERSONAL,
  PERSONAL_BODIES,
  PERSONAL_SUBJECTS,
  pick,
  REPLY_BODIES,
  type ReplyKind,
  type Rng,
  SIGN_OFFS,
  seeded,
} from "./pools.js";
import {
  FIXTURE_DKIM_SELECTOR,
  fixtureDkimKey,
  MAILBOX_ADDRESS,
  PERSON_NAME,
  type RequestKey,
  requestOf,
  targetOf,
  type WorldRequest,
} from "./world.js";

const FIXTURES = join(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "fixtures",
  "mail-intake",
);
const DEV_SHARE = 0.6;
const WINDOW_START = Date.parse("2026-09-26T06:00:00Z");
const WINDOW_MINUTES = 12 * 24 * 60;

type Part = { type: string; body: string; extra?: string };

interface Draft {
  category: string;
  outcome: Outcome;
  request: RequestKey | null;
  classification: ReplyClassification | null;
  from: { name: string | null; address: string };
  subject: string;
  date: Date;
  headers: Array<[string, string]>;
  /** The message body; a second part makes it multipart/alternative. */
  parts: Part[];
  contentType?: string;
  messageId: string;
  signAs?: string;
}

interface Category {
  name: string;
  count: number;
  make(rng: Rng, index: number): Draft;
}

const when = (rng: Rng) => new Date(WINDOW_START + int(rng, 0, WINDOW_MINUTES) * 60_000);

function rfcDate(date: Date): string {
  return `${date.toUTCString().replace("GMT", "+0000")}`;
}

function address(name: string | null, email: string): string {
  return name ? `${name} <${email}>` : email;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? `{${key}}`);
}

function serialize(draft: Draft): string {
  const lines: string[] = [];
  const fromDomain = draft.from.address.split("@")[1] as string;
  const returnPath = draft.headers.find(([name]) => name === "Return-Path")?.[1];
  lines.push(`Return-Path: ${returnPath ?? `<${draft.from.address}>`}`);
  lines.push(
    `Received: from mail.${fromDomain} (mail.${fromDomain} [203.0.113.${(fromDomain.length % 200) + 10}]) by mx.example.com with ESMTPS id ${hex(seeded(draft.messageId.length), 10)} for <${MAILBOX_ADDRESS}>; ${rfcDate(draft.date)}`,
  );
  lines.push(`From: ${address(draft.from.name, draft.from.address)}`);
  lines.push(`To: ${MAILBOX_ADDRESS}`);
  lines.push(`Subject: ${draft.subject}`);
  lines.push(`Date: ${rfcDate(draft.date)}`);
  lines.push(`Message-ID: ${draft.messageId}`);
  for (const [name, value] of draft.headers) {
    if (name !== "Return-Path") lines.push(`${name}: ${value}`);
  }
  lines.push("MIME-Version: 1.0");

  const [first, ...rest] = draft.parts;
  if (!first) throw new Error("A draft needs a body");
  if (rest.length === 0 && !draft.contentType) {
    lines.push(`Content-Type: ${first.type}; charset=utf-8`);
    lines.push("Content-Transfer-Encoding: 7bit");
    lines.push("", first.body);
  } else {
    const boundary = `----=_Part_${hex(seeded(draft.messageId.length * 7), 12)}`;
    lines.push(
      `Content-Type: ${draft.contentType ?? "multipart/alternative"}; boundary="${boundary}"`,
    );
    lines.push("");
    for (const part of draft.parts) {
      lines.push(`--${boundary}`);
      lines.push(`Content-Type: ${part.type}${part.extra ?? "; charset=utf-8"}`);
      if (part.type.startsWith("text/")) lines.push("Content-Transfer-Encoding: 7bit");
      lines.push("", part.body);
    }
    lines.push(`--${boundary}--`);
  }
  return `${lines.join("\r\n").replace(/\r?\n/g, "\r\n")}\r\n`;
}

async function sign(raw: string, draft: Draft): Promise<string> {
  if (!draft.signAs) return raw;
  const entry = {
    signingDomain: draft.signAs,
    selector: FIXTURE_DKIM_SELECTOR,
    privateKey: fixtureDkimKey().privatePem,
  };
  const { signatures, errors } = await dkimSign(raw, {
    ...entry,
    signTime: draft.date,
    signatureData: [entry],
  });
  if (errors.length > 0) throw new Error(`Signing failed: ${JSON.stringify(errors)}`);
  return signatures + raw;
}

function plain(text: string): Part {
  return { type: "text/plain", body: text };
}

function html(inner: string): Part {
  return {
    type: "text/html",
    body: `<html><body style="font-family:Arial,sans-serif">${inner}</body></html>`,
  };
}

function base(rng: Rng, from: Draft["from"], subject: string, text: string): Draft {
  return {
    category: "",
    outcome: "ignore",
    request: null,
    classification: null,
    from,
    subject,
    date: when(rng),
    headers: [],
    parts: [plain(text)],
    messageId: `<${hex(rng, 24)}@${from.address.split("@")[1]}>`,
  };
}

function bulkHeaders(rng: Rng, domain: string, listId?: string): Array<[string, string]> {
  const token = hex(rng, 16);
  return [
    ["Return-Path", `<bounce-${digits(rng, 6)}@bounce.${domain}>`],
    ["Reply-To", `no-reply@${domain}`],
    [
      "List-Unsubscribe",
      `<https://${domain}/unsubscribe?u=${token}>, <mailto:unsubscribe-${token.slice(0, 8)}@${domain}>`,
    ],
    ["List-Unsubscribe-Post", "List-Unsubscribe=One-Click"],
    ...(listId ? ([["List-Id", `<${listId}>`]] as Array<[string, string]>) : []),
    ["Precedence", "bulk"],
    [
      "X-Mailer",
      pick(rng, ["Salesforce Marketing Cloud", "SendGrid", "Mailchimp Mailer", "Braze"]),
    ],
  ];
}

function marketingBody(rng: Rng, brand: string, domain: string, headline: string): Part[] {
  const link = `https://${domain}/offers?ref=${hex(rng, 8)}`;
  const footer = `You are receiving this email because you have an account with ${brand}. To stop receiving these emails, unsubscribe: https://${domain}/unsubscribe`;
  return [
    plain(`${headline}\n\nShop now: ${link}\n\n${footer}`),
    html(
      `<h2>${headline}</h2><p><a href="${link}">Shop now</a></p><p style="font-size:11px">${footer}</p>`,
    ),
  ];
}

// ---- ignore categories ------------------------------------------------------------------

const marketingTarget: Category = {
  name: "marketing_target",
  count: 30,
  make(rng, index) {
    const choice = index % 10;
    const [id, brand, local, subjects] =
      choice < 5
        ? ([
            "amazon",
            "Amazon",
            pick(rng, ["store-news", "prime", "deals-recommendations", "store-offers"]),
            AMAZON_MARKETING_SUBJECTS,
          ] as const)
        : choice < 8
          ? (["netflix", "Netflix", "info", NETFLIX_MARKETING_SUBJECTS] as const)
          : ([
              pick(rng, ["whitepages", "spokeo", "beenverified"]),
              "",
              "news",
              BROKER_MARKETING_SUBJECTS,
            ] as const);
    const target = targetOf(id);
    const domain = id === "netflix" ? "mailer.netflix.com" : target.domain;
    const headline = pick(rng, subjects);
    const draft = base(
      rng,
      { name: brand || target.name, address: `${local}@${domain}` },
      headline,
      "",
    );
    draft.category = "marketing_target";
    draft.parts = marketingBody(rng, brand || target.name, target.domain, headline);
    draft.headers = bulkHeaders(rng, target.domain);
    if (rng.next() < 0.7) draft.signAs = target.domain;
    return draft;
  },
};

const ORDER_BODIES = [
  "Hello Jordan,\n\nYour order has been processed and will ship soon.\n\nOrder #{order}\nItem: {item}\nTotal: USD {amount}\n\nTrack your package: https://{domain}/gp/your-account/order-details?orderID={order}",
  "Hi Jordan,\n\nYour package has been delivered. If you have not received it, please contact customer service.\n\nOrder #{order}\n{item}\n\nThank you for shopping with us.",
  "Hello,\n\nYour refund of USD {amount} for {item} has been processed. It may take 3-5 business days to appear on your statement.\n\nOrder #{order}",
  "Your request to return {item} has been received. Print the label below and drop it off at any carrier location.\n\nOrder #{order}\nhttps://{domain}/returns/{order}",
];

const ACCOUNT_BODIES = [
  "Hi Jordan,\n\nWe noticed a sign-in to your account from a new device. If this was you, there is nothing to do. If not, please verify your identity and change your password: https://{domain}/account/security\n",
  "Hello Jordan,\n\nYour payment method on file could not be charged. Please confirm your billing details to keep your membership active: https://{domain}/account/billing\n",
  "Hi,\n\nPlease confirm your new email address by clicking the link: https://{domain}/account/confirm-email?token={token}\n\nIf you did not make this change, contact support.",
  "Hello Jordan,\n\nYour membership renews on Oct 20. You do not need to take any action. Manage your account: https://{domain}/account",
];

const orderAccountTarget: Category = {
  name: "order_account_target",
  count: 30,
  make(rng, index) {
    const amazon = index % 3 !== 2;
    const target = targetOf(amazon ? "amazon" : "netflix");
    const transactional = amazon && rng.next() < 0.6;
    const local = amazon
      ? transactional
        ? pick(rng, ["shipment-tracking", "auto-confirm", "order-update"])
        : "account-update"
      : "info";
    const domain = amazon ? target.domain : "account.netflix.com";
    const item = pick(rng, ITEMS);
    const subject = transactional
      ? fill(pick(rng, ORDER_SUBJECTS), { item })
      : pick(rng, amazon ? AMAZON_ACCOUNT_SUBJECTS : NETFLIX_ACCOUNT_SUBJECTS);
    const values = {
      order: `${digits(rng, 3)}-${digits(rng, 7)}-${digits(rng, 7)}`,
      item,
      amount: `${int(rng, 8, 140)}.${digits(rng, 2)}`,
      domain: target.domain,
      token: hex(rng, 20),
    };
    const body = fill(pick(rng, transactional ? ORDER_BODIES : ACCOUNT_BODIES), values);
    const draft = base(rng, { name: target.name, address: `${local}@${domain}` }, subject, body);
    draft.category = "order_account_target";
    draft.headers = [
      ["Return-Path", `<0100${hex(rng, 20)}-${hex(rng, 8)}@bounces.${target.domain}>`],
      ...(rng.next() < 0.5
        ? ([["Auto-Submitted", "auto-generated"]] as Array<[string, string]>)
        : []),
      ["X-Mailer", "Transactional Mailer"],
    ];
    if (rng.next() < 0.75) draft.signAs = target.domain;
    return draft;
  },
};

const marketingOther: Category = {
  name: "marketing_other",
  count: 30,
  make(rng) {
    const sender = pick(rng, OTHER_MARKETING);
    const headline = pick(rng, sender.subjects);
    const draft = base(
      rng,
      { name: sender.name, address: `${sender.local}@${sender.domain}` },
      headline,
      "",
    );
    draft.category = "marketing_other";
    draft.parts = marketingBody(rng, sender.name, sender.domain, headline);
    draft.headers = bulkHeaders(rng, sender.domain);
    if (rng.next() < 0.7) draft.signAs = sender.domain;
    return draft;
  },
};

const newsletters: Category = {
  name: "newsletter",
  count: 20,
  make(rng) {
    const sender = pick(rng, NEWSLETTERS);
    const subject = pick(rng, sender.subjects);
    const draft = base(
      rng,
      { name: sender.name, address: `${sender.local}@${sender.domain}` },
      subject,
      "",
    );
    draft.category = "newsletter";
    draft.parts = [
      plain(
        `${subject}\n\nThis week we look at what changed, what did not, and what to read next.\nRead online: https://${sender.domain}/p/${hex(rng, 6)}\n\nYou are subscribed as ${MAILBOX_ADDRESS}. Unsubscribe: https://${sender.domain}/unsubscribe`,
      ),
      html(`<h1>${subject}</h1><p>This week we look at what changed.</p>`),
    ];
    draft.headers = [
      ["Return-Path", `<bounce-${digits(rng, 5)}@${sender.domain}>`],
      ["List-Id", `<${sender.listId}>`],
      ["List-Unsubscribe", `<https://${sender.domain}/unsubscribe?e=${hex(rng, 12)}>`],
      ["Precedence", "list"],
    ];
    if (sender.domain === "substack.com" || rng.next() < 0.5) draft.signAs = sender.domain;
    return draft;
  },
};

const personal: Category = {
  name: "personal",
  count: 25,
  make(rng) {
    const sender = pick(rng, PERSONAL);
    const first = (sender.name.split(" ")[0] as string).replace(/[()]/g, "");
    const subject = pick(rng, PERSONAL_SUBJECTS);
    const body = fill(pick(rng, PERSONAL_BODIES), {
      first: FIRST_NAMES.includes(first) ? first : first,
    });
    const draft = base(rng, { name: sender.name, address: sender.address }, subject, body);
    draft.category = "personal";
    if (subject.startsWith("Re:")) {
      const parent = `<${hex(rng, 20)}@mail.example.com>`;
      draft.headers.push(["In-Reply-To", parent], ["References", parent]);
    }
    if (sender.address.endsWith("gmail.com") && rng.next() < 0.7) draft.signAs = "gmail.com";
    return draft;
  },
};

const bankSecurity: Category = {
  name: "bank_security",
  count: 15,
  make(rng) {
    const bank = pick(rng, BANKS);
    const subject = pick(rng, bank.subjects);
    const body = fill(pick(rng, BANK_BODIES), {
      domain: bank.domain,
      token: hex(rng, 24),
      amount: `${int(rng, 12, 900)}.${digits(rng, 2)}`,
    });
    const draft = base(
      rng,
      { name: bank.name, address: `${bank.local}@${bank.domain}` },
      subject,
      body,
    );
    draft.category = "bank_security";
    draft.headers = [
      ["Auto-Submitted", "auto-generated"],
      ["X-Priority", "1"],
    ];
    if (rng.next() < 0.85) draft.signAs = bank.domain;
    return draft;
  },
};

const calendar: Category = {
  name: "calendar_invite",
  count: 10,
  make(rng) {
    const event = pick(rng, CALENDAR_EVENTS);
    const start = new Date(WINDOW_START + int(rng, 14, 30) * 24 * 3600_000);
    const stamp = start.toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
    const organizer = pick(rng, PERSONAL);
    const viaGoogle = rng.next() < 0.5;
    const draft = base(
      rng,
      viaGoogle
        ? { name: organizer.name, address: "calendar-notification@google.com" }
        : { name: organizer.name, address: organizer.address },
      `Invitation: ${event} @ ${start.toUTCString().slice(0, 16)}`,
      "",
    );
    draft.category = "calendar_invite";
    draft.parts = [
      plain(
        `${organizer.name} has invited you to ${event}.\nWhen: ${start.toUTCString()}\nJoin: https://meet.example.com/${hex(rng, 3)}-${hex(rng, 4)}`,
      ),
      {
        type: "text/calendar",
        extra: "; charset=utf-8; method=REQUEST",
        body: [
          "BEGIN:VCALENDAR",
          "VERSION:2.0",
          "PRODID:-//Synthetic Calendar//EN",
          "METHOD:REQUEST",
          "BEGIN:VEVENT",
          `UID:${hex(rng, 16)}@example.com`,
          `DTSTAMP:${stamp}`,
          `DTSTART:${stamp}`,
          `SUMMARY:${event}`,
          `ORGANIZER;CN=${organizer.name}:mailto:${organizer.address}`,
          `ATTENDEE;RSVP=TRUE:mailto:${MAILBOX_ADDRESS}`,
          "END:VEVENT",
          "END:VCALENDAR",
        ].join("\r\n"),
      },
    ];
    draft.headers = viaGoogle ? [["Auto-Submitted", "auto-generated"]] : [];
    if (viaGoogle) draft.signAs = "google.com";
    return draft;
  },
};

const targetNoRequest: Category = {
  name: "target_no_request",
  count: 15,
  make(rng) {
    const sender = pick(rng, NO_REQUEST_TARGETS);
    const subject = pick(rng, sender.subjects);
    const draft = base(
      rng,
      { name: sender.name, address: `${sender.local}@${sender.domain}` },
      subject,
      "",
    );
    draft.category = "target_no_request";
    draft.parts = marketingBody(rng, sender.name, sender.domain, subject);
    draft.headers = bulkHeaders(rng, sender.domain);
    if (rng.next() < 0.6) draft.signAs = sender.domain;
    return draft;
  },
};

const strayAutomatic: Category = {
  name: "stray_automatic",
  count: 10,
  make(rng, index) {
    if (index % 2 === 0) {
      const subject = `Automatic reply: ${pick(rng, ["Q3 planning", "Contract draft", "Lunch tomorrow?"])}`;
      const draft = base(
        rng,
        { name: "Dana Okafor", address: "dana.okafor@acme-corp.example" },
        subject,
        `${fill(pick(rng, OUT_OF_OFFICE), { date: "Oct 19" })}\n\nDana`,
      );
      draft.category = "stray_automatic";
      draft.headers = [
        ["Auto-Submitted", "auto-replied"],
        ["X-Auto-Response-Suppress", "All"],
        ["In-Reply-To", `<${hex(rng, 20)}@example.com>`],
      ];
      return draft;
    }
    const recipient = pick(rng, [
      "marcus@chenfamily.example",
      "sam.rivera82@gmail.com",
      "old.landlord@rentals.example",
    ]);
    const draft = bounceDraft(
      rng,
      "Delivery Status Notification (Failure)",
      recipient,
      `<${hex(rng, 20)}@example.com>`,
      `To: ${recipient}`,
    );
    draft.category = "stray_automatic";
    return draft;
  },
};

// ---- request categories -----------------------------------------------------------------

const MAIL_REQUESTS: RequestKey[] = [
  "spokeo",
  "whitepages",
  "beenverified",
  "radaris",
  "amazon",
  "netflix",
];

function requestSubject(request: WorldRequest): string {
  return targetOf(request.targetId).kind === "company"
    ? `Data deletion request ${request.reference}`
    : `Opt-out request ${request.reference}`;
}

function quotedOriginal(request: WorldRequest): string {
  const target = targetOf(request.targetId);
  const sent = new Date(request.sentAt);
  return [
    `On ${sent.toUTCString().slice(0, 16)} at ${sent.toISOString().slice(11, 16)} ${PERSON_NAME} <${MAILBOX_ADDRESS}> wrote:`,
    `> Subject: ${requestSubject(request)}`,
    ">",
    `> To the privacy team at ${target.name},`,
    ">",
    `> I am asking you to ${request.rights.includes("delete") ? "delete my personal data" : "remove my listing and stop selling my information"}.`,
    `> Name: ${PERSON_NAME}`,
    `> Email: ${MAILBOX_ADDRESS}`,
    "> Please confirm once this is done.",
    ">",
    `> Reference: ${request.reference}`,
  ].join("\n");
}

function replyText(
  rng: Rng,
  kind: ReplyKind,
  request: WorldRequest,
  options: { quote: boolean; reference?: "footer" | "none" },
): string {
  const target = targetOf(request.targetId);
  const values = {
    brand: target.name,
    name: PERSON_NAME,
    email: MAILBOX_ADDRESS,
    domain: target.domain,
    ticket: `#${digits(rng, 6)}`,
  };
  const parts = [
    pick(rng, FIRST_LINE_GREETINGS),
    fill(pick(rng, REPLY_BODIES[kind]), values),
    ...(kind === "verification_required" && rng.next() < 0.5
      ? ["Please include:\n- Full name\n- Date of birth\n- Current street address"]
      : []),
    fill(pick(rng, SIGN_OFFS), values),
  ];
  if (options.reference === "footer") parts.push(`Your reference: ${request.reference}`);
  if (options.quote) parts.push(quotedOriginal(request));
  return parts.join("\n\n");
}

function brokerSender(rng: Rng, request: WorldRequest, domain?: string): Draft["from"] {
  const target = targetOf(request.targetId);
  const local = pick(rng, ["privacy", "privacy", "support", "dsar", "no-reply", "privacyteam"]);
  return { name: `${target.name} Privacy`, address: `${local}@${domain ?? target.domain}` };
}

function replyDraft(
  rng: Rng,
  category: string,
  kind: ReplyKind,
  request: WorldRequest,
  setup: {
    quote: boolean;
    threaded: boolean;
    subject: "re" | "reference" | "plain";
    reference?: "footer" | "none";
    signed: boolean;
    domain?: string;
    from?: Draft["from"];
    outcome: Outcome;
  },
): Draft {
  const from = setup.from ?? brokerSender(rng, request, setup.domain);
  const subject =
    setup.subject === "re"
      ? `Re: ${requestSubject(request)}`
      : setup.subject === "reference"
        ? pick(rng, [
            `Your privacy request ${request.reference}`,
            `Update on request ${request.reference}`,
            `Re: ${requestSubject(request)}`,
          ])
        : pick(rng, ["Your privacy request", "Regarding your message", "Re: your request"]);
  const draft = base(rng, from, subject, replyText(rng, kind, request, setup));
  draft.category = category;
  draft.outcome = setup.outcome;
  draft.request = request.key;
  draft.classification = kind === "auto_ack" ? "auto_ack" : kind;
  draft.date = new Date(Math.max(draft.date.getTime(), Date.parse(request.sentAt) + 3600_000));
  draft.headers = [
    ["Return-Path", `<bounce-${digits(rng, 5)}@${from.address.split("@")[1]}>`],
    ...(rng.next() < 0.3
      ? ([["Reply-To", `privacy@${from.address.split("@")[1]}`]] as Array<[string, string]>)
      : []),
    ...(setup.threaded
      ? ([
          ["In-Reply-To", request.outgoingMessageId],
          ["References", request.outgoingMessageId],
        ] as Array<[string, string]>)
      : []),
    ...(kind === "auto_ack"
      ? ([["Auto-Submitted", "auto-replied"]] as Array<[string, string]>)
      : []),
  ];
  if (setup.signed) draft.signAs = setup.domain ?? targetOf(request.targetId).domain;
  return draft;
}

type Mix = ReadonlyArray<readonly [ReplyKind, number]>;

function expand(mix: Mix): ReplyKind[] {
  return mix.flatMap(([kind, count]) => Array.from({ length: count }, () => kind));
}

function requestFor(index: number, keys: readonly RequestKey[] = MAIL_REQUESTS): WorldRequest {
  return requestOf(keys[index % keys.length] as RequestKey);
}

const QUOTED_SIGNED = expand([
  ["completed", 8],
  ["no_record", 5],
  ["rejected", 4],
  ["verification_required", 6],
  ["needs_form", 4],
  ["auto_ack", 3],
]);
const replyQuotedSigned: Category = {
  name: "reply_quoted_signed",
  count: QUOTED_SIGNED.length,
  make(rng, index) {
    return replyDraft(
      rng,
      "reply_quoted_signed",
      QUOTED_SIGNED[index] as ReplyKind,
      requestFor(index),
      {
        quote: true,
        threaded: true,
        subject: "re",
        signed: true,
        outcome: "auto",
      },
    );
  },
};

const QUOTED_UNSIGNED = expand([
  ["completed", 4],
  ["no_record", 3],
  ["rejected", 2],
  ["verification_required", 2],
  ["needs_form", 1],
  ["auto_ack", 3],
]);
const replyQuotedUnsigned: Category = {
  name: "reply_quoted_unsigned",
  count: QUOTED_UNSIGNED.length,
  make(rng, index) {
    const kind = QUOTED_UNSIGNED[index] as ReplyKind;
    return replyDraft(rng, "reply_quoted_unsigned", kind, requestFor(index + 2), {
      quote: true,
      threaded: true,
      subject: "re",
      signed: false,
      outcome: kind === "auto_ack" ? "auto" : "review",
    });
  },
};

const REFERENCE_SIGNED = expand([
  ["completed", 4],
  ["no_record", 2],
  ["rejected", 1],
  ["verification_required", 2],
  ["needs_form", 1],
  ["auto_ack", 2],
]);
const replyReferenceSigned: Category = {
  name: "reply_reference_signed",
  count: REFERENCE_SIGNED.length,
  make(rng, index) {
    return replyDraft(
      rng,
      "reply_reference_signed",
      REFERENCE_SIGNED[index] as ReplyKind,
      requestFor(index + 1),
      {
        quote: false,
        threaded: false,
        subject: "reference",
        signed: true,
        outcome: "auto",
      },
    );
  },
};

const REFERENCE_UNSIGNED = expand([
  ["completed", 4],
  ["no_record", 2],
  ["rejected", 2],
  ["verification_required", 2],
  ["needs_form", 1],
  ["auto_ack", 2],
]);
const replyReferenceUnsigned: Category = {
  name: "reply_reference_unsigned",
  count: REFERENCE_UNSIGNED.length,
  make(rng, index) {
    const kind = REFERENCE_UNSIGNED[index] as ReplyKind;
    const inBody = index % 3 === 0;
    return replyDraft(rng, "reply_reference_unsigned", kind, requestFor(index + 3), {
      quote: false,
      threaded: false,
      subject: inBody ? "plain" : "reference",
      reference: inBody ? "footer" : "none",
      signed: false,
      outcome: kind === "auto_ack" ? "auto" : "review",
    });
  },
};

const TICKET = expand([
  ["auto_ack", 6],
  ["completed", 3],
  ["verification_required", 3],
  ["no_record", 3],
]);
const ticketSystem: Category = {
  name: "ticket_system",
  count: TICKET.length,
  make(rng, index) {
    const kind = TICKET[index] as ReplyKind;
    const request = requestFor(index, ["whitepages", "radaris", "beenverified", "spokeo"]);
    const target = targetOf(request.targetId);
    const desk = pick(rng, ["zendesk.com", "freshdesk.com", "helpscoutdocs.example"]);
    const ticket = digits(rng, 5);
    const draft = replyDraft(rng, "ticket_system", kind, request, {
      quote: false,
      threaded: false,
      subject: "reference",
      signed: false,
      from: { name: `${target.name} Support`, address: `support@${target.id}.${desk}` },
      outcome: kind === "auto_ack" ? "auto" : "review",
    });
    draft.subject = `[${target.name}] Re: ${requestSubject(request)} (Ticket #${ticket})`;
    draft.parts = [
      plain(
        `${replyText(rng, kind, request, { quote: false })}\n\n-- \nTicket #${ticket} | ${target.name} Support\nReply above this line to respond.\nRequest: ${request.reference}`,
      ),
    ];
    draft.headers = [
      ["Return-Path", `<bounces+${ticket}@${target.id}.${desk}>`],
      ["Reply-To", `support+id${ticket}@${target.id}.${desk}`],
      ["X-Mailer", desk.startsWith("zendesk") ? "Zendesk" : "Support Desk"],
      ...(kind === "auto_ack"
        ? ([["Auto-Submitted", "auto-generated"]] as Array<[string, string]>)
        : []),
    ];
    return draft;
  },
};

const SISTER: ReadonlyArray<readonly [ReplyKind, boolean]> = [
  ["completed", true],
  ["completed", true],
  ["no_record", true],
  ["no_record", true],
  ["verification_required", true],
  ["verification_required", true],
  ["completed", false],
  ["completed", false],
  ["no_record", false],
  ["no_record", false],
];
const sisterDomain: Category = {
  name: "sister_domain",
  count: SISTER.length,
  make(rng, index) {
    const [kind, listed] = SISTER[index] as readonly [ReplyKind, boolean];
    const request = requestOf("spokeo");
    const domain = listed ? "spokeo-support.com" : "spokeo-privacy.net";
    return replyDraft(rng, "sister_domain", kind, request, {
      quote: listed,
      threaded: listed,
      subject: listed ? "re" : "reference",
      signed: listed,
      domain,
      from: { name: "Spokeo Privacy Operations", address: `privacy@${domain}` },
      outcome: listed ? "auto" : "review",
    });
  },
};

const CLEAR = expand([
  ["completed", 3],
  ["no_record", 3],
  ["rejected", 1],
  ["verification_required", 2],
  ["needs_form", 1],
  ["auto_ack", 5],
]);
const noReferenceClear: Category = {
  name: "no_reference_clear",
  count: CLEAR.length,
  make(rng, index) {
    const kind = CLEAR[index] as ReplyKind;
    const request = requestFor(index, [
      "spokeo",
      "whitepages",
      "beenverified",
      "radaris",
      "intelius",
    ]);
    const target = targetOf(request.targetId);
    const draft = replyDraft(rng, "no_reference_clear", kind, request, {
      quote: false,
      threaded: false,
      subject: "plain",
      signed: index % 3 === 0,
      outcome: kind === "auto_ack" ? "auto" : "review",
    });
    const values = {
      brand: target.name,
      name: PERSON_NAME,
      email: MAILBOX_ADDRESS,
      domain: target.domain,
    };
    draft.parts = [
      plain(
        `${pick(rng, FIRST_LINE_GREETINGS)}\n\n${fill(pick(rng, CLEAR_NO_REFERENCE[kind]), values)}\n\n${fill(pick(rng, SIGN_OFFS), values)}`,
      ),
    ];
    return draft;
  },
};

const UNKNOWN_SENDER: ReadonlyArray<ReplyKind> = [
  "completed",
  "completed",
  "no_record",
  "verification_required",
  "completed",
];
const unknownSenderClear: Category = {
  name: "unknown_sender_clear",
  count: UNKNOWN_SENDER.length,
  make(rng, index) {
    const kind = UNKNOWN_SENDER[index] as ReplyKind;
    const request = requestFor(index, ["spokeo", "whitepages", "beenverified", "radaris"]);
    const target = targetOf(request.targetId);
    const outsourced = pick(rng, [
      "datasafe-support.net",
      "privacyops.example",
      "optout-desk.example",
    ]);
    const draft = replyDraft(rng, "unknown_sender_clear", kind, request, {
      quote: false,
      threaded: false,
      subject: "plain",
      signed: false,
      from: { name: "Privacy Operations", address: `team@${outsourced}` },
      outcome: "review",
    });
    const values = {
      brand: target.name,
      name: PERSON_NAME,
      email: MAILBOX_ADDRESS,
      domain: target.domain,
    };
    draft.subject = `Your ${target.name} opt-out`;
    draft.parts = [
      plain(
        `Hello,\n\nWe handle privacy requests for ${target.name}. Regarding the opt-out for ${PERSON_NAME}: ${fill(pick(rng, CLEAR_NO_REFERENCE[kind]), values)}\n\n${fill(pick(rng, SIGN_OFFS), values)}`,
      ),
    ];
    return draft;
  },
};

const CONFIRMATIONS: ReadonlyArray<readonly [RequestKey, boolean, boolean]> = [
  ["intelius", true, true],
  ["intelius", true, true],
  ["intelius", true, true],
  ["intelius", true, true],
  ["intelius", true, true],
  ["intelius", true, true],
  ["intelius", false, false],
  ["intelius", false, false],
  ["intelius", false, false],
  ["spokeo", true, true],
  ["beenverified", true, true],
  ["spokeo", true, true],
  ["whitepages", true, true],
  ["spokeo", false, false],
  ["beenverified", false, false],
];
const confirmationLink: Category = {
  name: "confirmation_link",
  count: CONFIRMATIONS.length,
  make(rng, index) {
    const [key, signed, auto] = CONFIRMATIONS[index] as readonly [RequestKey, boolean, boolean];
    const request = requestOf(key);
    const target = targetOf(request.targetId);
    const link = `https://${target.domain}/optout/confirm?token=${hex(rng, 28)}`;
    const awaiting = request.awaitingConfirmation !== null;
    const subject = awaiting
      ? pick(rng, [
          "Confirm your opt-out request",
          "Please verify your email to finish your removal",
          "Action required: confirm removal",
        ])
      : `Confirm your opt-out request ${request.reference}`;
    const draft = base(
      rng,
      {
        name: `${target.name}`,
        address: `${pick(rng, ["noreply", "privacy", "no-reply"])}@${target.domain}`,
      },
      subject,
      `Hello,\n\nWe received a request to remove your information from ${target.name}. To complete your removal, please confirm your email address by clicking the link below.\n\n${link}\n\nIf you did not make this request, ignore this message.\n\n${target.name} Privacy Team`,
    );
    draft.category = "confirmation_link";
    draft.outcome = auto ? "auto" : "review";
    draft.request = key;
    draft.classification = "confirmation_link";
    draft.date = new Date(Math.max(draft.date.getTime(), Date.parse(request.sentAt) + 600_000));
    draft.parts = [
      plain(draft.parts[0]?.body ?? ""),
      html(
        `<p>To complete your removal, please confirm your email address.</p><p><a href="${link}">Confirm my request</a></p>`,
      ),
    ];
    draft.headers = [
      ["Return-Path", `<bounce-${digits(rng, 4)}@${target.domain}>`],
      ["Auto-Submitted", "auto-generated"],
    ];
    if (signed) draft.signAs = target.domain;
    return draft;
  },
};

const autoresponder: Category = {
  name: "autoresponder",
  count: 10,
  make(rng, index) {
    const request = requestFor(index, [
      "spokeo",
      "whitepages",
      "beenverified",
      "radaris",
      "amazon",
    ]);
    const target = targetOf(request.targetId);
    const away = index % 2 === 0;
    const draft = base(
      rng,
      { name: `${target.name} Privacy`, address: `no-reply@${target.domain}` },
      `${away ? "Automatic reply" : "Auto-reply"}: ${requestSubject(request)}`,
      `${away ? fill(pick(rng, OUT_OF_OFFICE), { date: "Oct 14" }) : fill(pick(rng, REPLY_BODIES.auto_ack), { brand: target.name, ticket: `#${digits(rng, 6)}` })}\n\n${away ? "" : quotedOriginal(request)}`,
    );
    draft.category = "autoresponder";
    draft.outcome = "auto";
    draft.request = request.key;
    draft.classification = "auto_ack";
    draft.date = new Date(Math.max(draft.date.getTime(), Date.parse(request.sentAt) + 60_000));
    draft.headers = [
      ["Auto-Submitted", "auto-replied"],
      ["Precedence", "auto_reply"],
      ["In-Reply-To", request.outgoingMessageId],
      ["References", request.outgoingMessageId],
    ];
    return draft;
  },
};

const bounces: Category = {
  name: "bounce",
  count: 10,
  make(rng, index) {
    const request = requestFor(index, ["spokeo", "whitepages", "beenverified", "radaris"]);
    const target = targetOf(request.targetId);
    const delay = index >= 6;
    const draft = bounceDraft(
      rng,
      delay ? "Delivery Status Notification (Delay)" : "Delivery Status Notification (Failure)",
      target.privacyEmail,
      request.outgoingMessageId,
      `Subject: ${requestSubject(request)}`,
      delay,
    );
    draft.category = "bounce";
    draft.outcome = delay ? "auto" : "review";
    draft.request = request.key;
    draft.classification = delay ? "auto_ack" : "bounce";
    draft.date = new Date(Math.max(draft.date.getTime(), Date.parse(request.sentAt) + 120_000));
    return draft;
  },
};

function bounceDraft(
  rng: Rng,
  subject: string,
  failedRecipient: string,
  originalMessageId: string,
  originalHeader: string,
  delay = false,
): Draft {
  const reason = pick(rng, BOUNCE_REASONS);
  const draft = base(
    rng,
    { name: "Mail Delivery Subsystem", address: "mailer-daemon@googlemail.com" },
    subject,
    "",
  );
  const summary = delay
    ? `Delivery to the following recipient has been delayed:\n\n    ${failedRecipient}\n\nThe server will continue trying to deliver the message for 2 more days.`
    : `Delivery to the following recipient failed permanently:\n\n    ${failedRecipient}\n\nThe response was:\n${reason}`;
  draft.parts = [
    plain(summary),
    {
      type: "message/delivery-status",
      extra: "",
      body: `Reporting-MTA: dns; googlemail.com\r\nFinal-Recipient: rfc822; ${failedRecipient}\r\nAction: ${delay ? "delayed" : "failed"}\r\nStatus: ${delay ? "4.4.1" : "5.1.1"}\r\nDiagnostic-Code: smtp; ${reason}`,
    },
    {
      type: "message/rfc822",
      extra: "",
      body: `Message-ID: ${originalMessageId}\r\nFrom: ${MAILBOX_ADDRESS}\r\nTo: ${failedRecipient}\r\n${originalHeader}\r\nDate: Mon, 21 Sep 2026 14:05:00 +0000\r\n\r\n(original message body omitted)`,
    },
  ];
  draft.contentType = "multipart/report; report-type=delivery-status";
  draft.headers = [
    ["Return-Path", "<>"],
    ["Auto-Submitted", "auto-replied"],
    ["X-Failed-Recipients", failedRecipient],
  ];
  return draft;
}

const CATEGORIES: readonly Category[] = [
  marketingTarget,
  orderAccountTarget,
  marketingOther,
  newsletters,
  personal,
  bankSecurity,
  calendar,
  targetNoRequest,
  strayAutomatic,
  replyQuotedSigned,
  replyQuotedUnsigned,
  replyReferenceSigned,
  replyReferenceUnsigned,
  ticketSystem,
  sisterDomain,
  noReferenceClear,
  unknownSenderClear,
  confirmationLink,
  autoresponder,
  bounces,
];

interface Built {
  draft: Draft;
  raw: string;
}

/** Writes both sets. Each category is split by position, so both sets hold every kind of mail. */
export async function generateCorpus(root = FIXTURES): Promise<{ dev: number; heldOut: number }> {
  const sets: Record<"dev" | "held-out", Built[]> = { dev: [], "held-out": [] };
  for (const [position, category] of CATEGORIES.entries()) {
    const rng = seeded(1000 + position);
    for (let index = 0; index < category.count; index += 1) {
      const draft = category.make(rng, index);
      const set = goesToDev(index) ? "dev" : "held-out";
      sets[set].push({ draft, raw: await sign(serialize(draft), draft) });
    }
  }

  const counts = { dev: 0, heldOut: 0 };
  for (const set of ["dev", "held-out"] as const) {
    const dir = join(root, set);
    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir, { recursive: true });
    const ordered = sets[set].sort((a, b) => a.draft.date.getTime() - b.draft.date.getTime());
    const labels: MessageLabel[] = ordered.map(({ draft, raw }, index) => {
      const file = `${String(index + 1).padStart(4, "0")}-${draft.category}.eml`;
      writeFileSync(join(dir, file), raw);
      return {
        file,
        category: draft.category,
        outcome: draft.outcome,
        request: draft.request,
        classification: draft.classification,
      };
    });
    writeFileSync(join(dir, "labels.json"), `${JSON.stringify(labels, null, 2)}\n`);
    counts[set === "dev" ? "dev" : "heldOut"] = labels.length;
  }
  return counts;
}

/** Spreads the dev share evenly through a category, so both sets hold every kind of mail it has. */
function goesToDev(index: number): boolean {
  return Math.floor((index + 1) * DEV_SHARE) > Math.floor(index * DEV_SHARE);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  generateCorpus().then((counts) => {
    console.log(`Wrote ${counts.dev} dev and ${counts.heldOut} held-out messages`);
  });
}
