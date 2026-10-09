import { closeSync, existsSync, fsyncSync, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import type { Clock } from "./clock.js";
import type { Logger } from "./logger.js";

/** Append-only, one JSON object per line, in the data directory so a backup and a restore carry it. */
export const SENT_JOURNAL = "sent-journal";

/** Written into every backup archive: the moment the data was copied, which no file in it recorded before. */
export const BACKUP_TAKEN_AT = "backup-taken-at";

/** Left by `install.sh --restore` only when it copied the journal over from the volume it replaced. */
export const JOURNAL_CARRIED = "journal-carried";

export type SendChannel = "email" | "form" | "confirm" | "agent";

export interface JournalEntry {
  requestId: string;
  /** The Message-ID of a mail, or the id of the task or released request for a browser send. */
  ref: string;
  channel: SendChannel;
  /** Where an email went, so a send the restored database never saw can still be recorded in full. */
  recipient?: string | null;
  at: string;
}

/**
 * Remembers every send outside the database. A restore brings back a database that predates the
 * sends made since its backup, so the journal is what tells the restored instance that a request
 * already went out, without having to read it off the broker's side or a Sent folder that may not
 * keep SMTP sends.
 */
export interface SentJournal {
  append(entry: Omit<JournalEntry, "at">): void;
  entries(): JournalEntry[];
  /**
   * Whether the journal came from the instance that was replaced and the backup's time is known, so
   * it holds every send made after the backup. A journal that only came out of the archive stops at the backup.
   */
  coversTheGap(): boolean;
}

type JournalDeps = { dataDir: string; clock: Clock; logger: Logger };

export function createSentJournal({ dataDir, clock, logger }: JournalDeps): SentJournal {
  const path = join(dataDir, SENT_JOURNAL);

  const write = (line: string) => {
    const fd = openSync(path, "a", 0o600);
    try {
      writeSync(fd, line);
      // The line is the only record of a send the database may lose, so it has to reach the disk.
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  };

  // A journal that exists says the build that wrote the volume kept one, which a restore relies on.
  try {
    if (!existsSync(path)) write("");
  } catch (error) {
    logger.warn({ err: error }, "could not create the send journal");
  }

  return {
    append(entry) {
      try {
        write(`${JSON.stringify({ ...entry, at: clock.now().toISOString() })}\n`);
      } catch (error) {
        logger.error(
          { err: error, requestId: entry.requestId },
          "could not write the send journal",
        );
      }
    },

    entries() {
      let text: string;
      try {
        text = readFileSync(path, "utf8");
      } catch {
        return [];
      }
      const found: JournalEntry[] = [];
      for (const line of text.split("\n")) {
        if (line.trim() === "") continue;
        try {
          found.push(JSON.parse(line) as JournalEntry);
        } catch {
          // A line cut off by a power loss is the last one; the sends before it still count.
        }
      }
      return found;
    },

    coversTheGap() {
      return (
        existsSync(join(dataDir, JOURNAL_CARRIED)) && existsSync(join(dataDir, BACKUP_TAKEN_AT))
      );
    },
  };
}
