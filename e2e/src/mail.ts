import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { createTransport } from "nodemailer";
import { STACK } from "./stack.js";

export interface SeenMail {
  uid: number;
  messageId: string | null;
  from: string;
  to: string[];
  subject: string;
  text: string;
  inReplyTo: string | null;
}

/** Everything in an address's inbox on GreenMail, which is the only mail server the stack has. */
export async function readInbox(address: string): Promise<SeenMail[]> {
  const client = new ImapFlow({
    host: STACK.host,
    port: STACK.imapPort,
    secure: false,
    auth: { user: address, pass: "greenmail" },
    logger: false,
  });
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const seen: SeenMail[] = [];
      for await (const message of client.fetch(
        "1:*",
        { uid: true, source: true },
        { uid: false },
      )) {
        if (!message.source) continue;
        const parsed = await simpleParser(message.source);
        const to = [parsed.to]
          .flat()
          .flatMap((field) => field?.value ?? [])
          .map((entry) => entry.address ?? "");
        seen.push({
          uid: message.uid,
          messageId: parsed.messageId ?? null,
          from: parsed.from?.value[0]?.address ?? "",
          to,
          subject: parsed.subject ?? "",
          text: parsed.text ?? "",
          inReplyTo: typeof parsed.inReplyTo === "string" ? parsed.inReplyTo : null,
        });
      }
      return seen;
    } finally {
      lock.release();
    }
  } finally {
    await client.logout();
  }
}

const DKIM_SELECTOR = "e2e";

/** The private half of the key `run.mjs` made for this run, whose public half the server was given. */
const dkimPrivateKey = (): string =>
  readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "..", ".dkim", "private.pem"),
    "utf8",
  );

export interface Delivery {
  from: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string | undefined;
  /** Sent as the raw message when a test needs headers nodemailer would not write, such as a bounce. It is signed like any other. */
  raw?: string | undefined;
  headers?: Record<string, string> | undefined;
  /** Skips the DKIM signature a broker's mail server would add, as a forger's mail lacks it. */
  unsigned?: boolean | undefined;
}

/** Puts a message in an inbox the way a broker's server would, through GreenMail's SMTP port. */
export async function deliver(mail: Delivery): Promise<string> {
  const domain = mail.from.slice(mail.from.lastIndexOf("@") + 1);
  const transport = createTransport({
    host: STACK.host,
    port: STACK.smtpPort,
    secure: false,
    ignoreTLS: true,
    ...(mail.unsigned
      ? {}
      : {
          dkim: { domainName: domain, keySelector: DKIM_SELECTOR, privateKey: dkimPrivateKey() },
        }),
  });
  const messageId = `<${randomBytes(8).toString("hex")}@broker.test>`;
  try {
    if (mail.raw) {
      await transport.sendMail({ envelope: { from: mail.from, to: mail.to }, raw: mail.raw });
    } else {
      await transport.sendMail({
        from: mail.from,
        to: mail.to,
        subject: mail.subject,
        text: mail.text,
        messageId,
        ...(mail.inReplyTo ? { inReplyTo: mail.inReplyTo, references: mail.inReplyTo } : {}),
        ...(mail.headers ? { headers: mail.headers } : {}),
      });
    }
  } finally {
    transport.close();
  }
  return messageId;
}

/** The sender of the delivery status report a broker's mail server writes for one of its own addresses. */
export const bounceSender = (failedAddress: string): string =>
  `mailer-daemon@${failedAddress.slice(failedAddress.lastIndexOf("@") + 1)}`;

/** A delivery status report from a mail server, as a broker's failing address produces. */
export function bounceMessage(to: string, failedAddress: string, original: SeenMail): string {
  return [
    `From: Mail Delivery Subsystem <${bounceSender(failedAddress)}>`,
    `To: ${to}`,
    "Subject: Delivery Status Notification (Failure)",
    `Message-ID: <${randomBytes(8).toString("hex")}@broker.test>`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    'Content-Type: multipart/report; report-type=delivery-status; boundary="bounce-boundary"',
    "Auto-Submitted: auto-replied",
    "",
    "--bounce-boundary",
    "Content-Type: text/plain; charset=utf-8",
    "",
    `Delivery to ${failedAddress} failed: the address does not accept mail.`,
    `Original subject: ${original.subject}`,
    "",
    "--bounce-boundary",
    "Content-Type: message/delivery-status",
    "",
    `Reporting-MTA: dns; ${failedAddress.slice(failedAddress.lastIndexOf("@") + 1)}`,
    "",
    `Final-Recipient: rfc822; ${failedAddress}`,
    "Action: failed",
    "Status: 5.1.1",
    "Diagnostic-Code: smtp; 550 5.1.1 User unknown",
    "",
    "--bounce-boundary",
    "Content-Type: text/rfc822-headers",
    "",
    `Subject: ${original.subject}`,
    `Message-ID: ${original.messageId ?? ""}`,
    "",
    "--bounce-boundary--",
    "",
  ].join("\r\n");
}
