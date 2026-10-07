import type { MailboxRow } from "@kickrocks/db";
import type { MailConnection } from "../mail/types.js";

/** The app password is stored as it is: the whole database file is encrypted. */
export function connectionOf(mailbox: MailboxRow): MailConnection {
  return {
    address: mailbox.address,
    username: mailbox.username,
    password: mailbox.secret,
    smtpHost: mailbox.smtpHost,
    smtpPort: mailbox.smtpPort,
    smtpSecure: mailbox.smtpSecure,
    imapHost: mailbox.imapHost,
    imapPort: mailbox.imapPort,
  };
}

/** A failure message that is safe to store and show: one line, and not unboundedly long. */
export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const oneLine = message.replace(/\s+/g, " ").trim();
  return (oneLine || "Unknown error").slice(0, 500);
}
