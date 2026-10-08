import { createTransport } from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import { z } from "zod";
import { describeMailError, isTrustedPlaintextHost } from "./net.js";
import type { MailConnection, MailTransport, OutgoingMail, SendResult } from "./types.js";

const CONNECTION_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 60_000;

const NoLineBreaks = z.string().regex(/^[^\r\n]*$/, "must be a single line");

const OutgoingMailSchema = z.object({
  from: z.object({
    name: NoLineBreaks.nullable(),
    address: z.email(),
  }),
  to: z.email(),
  subject: NoLineBreaks.min(1).max(900),
  text: z.string().min(1),
  messageId: z.string().regex(/^<[^<>\s@]+@[^<>\s@]+>$/, "must look like <local@domain>"),
  inReplyTo: z
    .string()
    .regex(/^<[^<>\s]+>$/)
    .optional(),
  references: z.array(z.string().regex(/^<[^<>\s]+>$/)).optional(),
});

/** A send that cannot succeed however often it is retried, because the mail itself is malformed. */
export class InvalidOutgoingMailError extends Error {
  override name = "InvalidOutgoingMailError";
}

/** What the library says about why a send failed, kept so callers can tell a bad mailbox from a bad request. */
export interface MailSendFailure {
  code?: string | undefined;
  responseCode?: number | undefined;
  command?: string | undefined;
  /** True only when the failure proves no message body reached the server, so sending again cannot duplicate it. */
  neverSent?: boolean | undefined;
}

/** Replies that refuse the login or the sender before any message body is offered. */
const REFUSED_BEFORE_DATA_REPLIES = new Set([421, 530, 534, 535, 538]);
const REFUSED_BEFORE_DATA_CODES = new Set([
  "EAUTH",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EDNS",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETLS",
]);

/**
 * Nodemailer reports a refused or unreachable connect as ESOCKET and drops the errno code, so the
 * connect command and message are all that tell it from the same code raised after DATA.
 */
function failedToConnect({ command, syscall, message }: Record<string, unknown>): boolean {
  if (typeof message !== "string") return false;
  if (!/^connect E(CONNREFUSED|HOSTUNREACH|NETUNREACH)\b/.test(message)) return false;
  return command === "CONN" || syscall === "connect";
}

/**
 * A dropped connection or a socket timeout can come after the server took the message but before
 * it said so, and nodemailer reports both under the same codes as a failed connect. Only the
 * failures that happen before DATA is offered prove the mail was not sent.
 */
export function provesNeverSent(error: unknown): boolean {
  const record = (error ?? {}) as Record<string, unknown>;
  const { code, responseCode, command, message } = record;
  if (typeof responseCode === "number" && REFUSED_BEFORE_DATA_REPLIES.has(responseCode)) {
    return true;
  }
  if (typeof code === "string" && REFUSED_BEFORE_DATA_CODES.has(code)) return true;
  if (typeof command === "string" && (command === "MAIL FROM" || command.startsWith("AUTH"))) {
    return true;
  }
  if (failedToConnect(record)) return true;
  return (
    typeof message === "string" && /^(Connection timeout|Greeting never received)/.test(message)
  );
}

/**
 * A send the server refused. The text is safe to show and never contains the app password, which
 * is why the original error is not kept as the cause: only its machine-readable fields are.
 */
export class MailSendError extends Error implements MailSendFailure {
  override name = "MailSendError";
  readonly code: string | undefined;
  readonly responseCode: number | undefined;
  readonly command: string | undefined;
  readonly neverSent: boolean;

  constructor(
    message: string,
    /** True when trying again later could work, as for a timeout or a 4xx reply. */
    readonly transient: boolean,
    failure: MailSendFailure = {},
  ) {
    super(message);
    this.code = failure.code;
    this.responseCode = failure.responseCode;
    this.command = failure.command;
    this.neverSent = failure.neverSent ?? false;
  }
}

function failureOf(error: unknown): MailSendFailure {
  const record = (error ?? {}) as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : undefined,
    responseCode: typeof record.responseCode === "number" ? record.responseCode : undefined,
    command: typeof record.command === "string" ? record.command : undefined,
    neverSent: provesNeverSent(error),
  };
}

/** Hosts that may be reached without TLS besides this machine. */
interface MailTransportOptions {
  plaintextHosts?: readonly string[];
  /** Shortened by tests that wait for a server that never answers. */
  timeouts?: { connectionMs: number; socketMs: number };
}

export function transportOptions(
  connection: MailConnection,
  {
    plaintextHosts = [],
    timeouts = { connectionMs: CONNECTION_TIMEOUT_MS, socketMs: SOCKET_TIMEOUT_MS },
  }: MailTransportOptions = {},
): SMTPTransport.Options {
  const local = isTrustedPlaintextHost(connection.smtpHost, plaintextHosts);
  return {
    host: connection.smtpHost,
    port: connection.smtpPort,
    secure: connection.smtpSecure,
    auth: { user: connection.username, pass: connection.password },
    // Credentials must never cross the network unencrypted, so STARTTLS is mandatory unless the
    // relay is on this machine or named by the operator, as with Proton Bridge and the test mail server.
    requireTLS: !connection.smtpSecure && !local,
    ...(local ? { tls: { rejectUnauthorized: false } } : {}),
    connectionTimeout: timeouts.connectionMs,
    greetingTimeout: timeouts.connectionMs,
    socketTimeout: timeouts.socketMs,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

function addressList(list: ReadonlyArray<string | { address: string }>): string[] {
  return list.map((entry) => (typeof entry === "string" ? entry : entry.address));
}

function isTransient(error: unknown): boolean {
  const record = (error ?? {}) as { responseCode?: number; code?: string };
  if (typeof record.responseCode === "number") return record.responseCode < 500;
  return record.code !== "EAUTH" && record.code !== "EENVELOPE" && record.code !== "EMESSAGE";
}

export function createMailTransport(
  connection: MailConnection,
  options: MailTransportOptions = {},
): MailTransport {
  const secrets = [connection.password];

  return {
    async verify() {
      const transporter = createTransport(transportOptions(connection, options));
      try {
        await transporter.verify();
        return { ok: true, error: null };
      } catch (error) {
        return { ok: false, error: describeMailError(error, secrets) };
      } finally {
        transporter.close();
      }
    },

    async send(mail: OutgoingMail): Promise<SendResult> {
      const parsed = OutgoingMailSchema.safeParse(mail);
      if (!parsed.success) {
        const issue = parsed.error.issues[0];
        throw new InvalidOutgoingMailError(
          `The outgoing mail is invalid: ${issue?.path.join(".") ?? "mail"} ${issue?.message ?? ""}`.trim(),
        );
      }
      const { from, to, subject, text, messageId, inReplyTo, references } = parsed.data;

      const transporter = createTransport(transportOptions(connection, options));
      try {
        // Plain text only: a reply is matched by Message-ID and reference, so the mail needs no
        // tracking pixel, no tracked link, and no HTML part.
        const info = await transporter.sendMail({
          from: from.name ? { name: from.name, address: from.address } : from.address,
          to,
          subject,
          text,
          messageId,
          ...(inReplyTo ? { inReplyTo } : {}),
          ...(references?.length ? { references } : {}),
        });
        const accepted = addressList(info.accepted);
        const rejected = addressList(info.rejected);
        if (accepted.length === 0) {
          throw new MailSendError(`The server did not accept ${to}`, false);
        }
        return { messageId: info.messageId || messageId, accepted, rejected };
      } catch (error) {
        if (error instanceof MailSendError) throw error;
        throw new MailSendError(
          describeMailError(error, secrets),
          isTransient(error),
          failureOf(error),
        );
      } finally {
        transporter.close();
      }
    },
  };
}
