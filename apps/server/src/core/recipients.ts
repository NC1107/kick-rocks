import { type KickRocksDb, outgoingMail } from "@kickrocks/db";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";

/**
 * The address a request was first mailed at. A follow-up and a verification reply go back to it,
 * because the dataset may later lose the broker's address or swap it for one nobody tried, and the
 * broker's reply, which is what matches the thread, came from the address that was written to.
 * Null for a request mailed before the address was recorded, or one that was never mailed.
 */
export function firstRecipient(db: KickRocksDb, requestId: string): string | null {
  return (
    db
      .select({ recipient: outgoingMail.recipient })
      .from(outgoingMail)
      .where(and(eq(outgoingMail.requestId, requestId), isNotNull(outgoingMail.recipient)))
      .orderBy(asc(outgoingMail.sentAt), asc(outgoingMail.id))
      .get()?.recipient ?? null
  );
}

/** `firstRecipient` for many requests in one query. Requests with no recorded address are absent. */
export function firstRecipients(
  db: KickRocksDb,
  requestIds: readonly string[],
): Map<string, string> {
  const first = new Map<string, string>();
  if (requestIds.length === 0) return first;
  const rows = db
    .select({ requestId: outgoingMail.requestId, recipient: outgoingMail.recipient })
    .from(outgoingMail)
    .where(and(inArray(outgoingMail.requestId, [...requestIds]), isNotNull(outgoingMail.recipient)))
    .orderBy(asc(outgoingMail.sentAt), asc(outgoingMail.id))
    .all();
  for (const { requestId, recipient } of rows) {
    if (recipient !== null && !first.has(requestId)) first.set(requestId, recipient);
  }
  return first;
}
