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
  }
}

function failureOf(error: unknown): MailSendFailure {
  const record = (error ?? {}) as Record<string, unknown>;
  return {
    code: typeof record.code === "string" ? record.code : undefined,
    responseCode: typeof record.responseCode === "number" ? record.responseCode : undefined,
    command: typeof record.command === "string" ? record.command : undefined,
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
