import { type KickRocksDb, outgoingMail } from "@kickrocks/db";
import { and, asc, eq, isNotNull } from "drizzle-orm";

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
