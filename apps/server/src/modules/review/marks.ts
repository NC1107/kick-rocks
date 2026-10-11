import { matches, type NeedsYouMarkRow, needsYouMarks, requests, tasks } from "@kickrocks/db";
import type { NeedsYouMark, NeedsYouRef } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { nowIso } from "../../core/clock.js";
import { notFound } from "../../core/errors.js";
import { newId } from "../../core/ids.js";
import type { AppServices } from "../../services.js";

/** Where a mark is stored, by the table its item comes from. */
const SUBJECT_COLUMN = {
  task: needsYouMarks.taskId,
  match: needsYouMarks.matchId,
  details: needsYouMarks.requestId,
} as const;

const SUBJECT_FIELD = { task: "taskId", match: "matchId", details: "requestId" } as const;

export interface Subject {
  ref: NeedsYouRef;
  id: string;
  profileId: string;
}

/** The profile an item belongs to, or a 404 when nothing by that id can ever be in the queue. */
export function subjectOf(services: AppServices, ref: NeedsYouRef, id: string): Subject {
  const row =
    ref === "task"
      ? services.db.select({ profileId: tasks.profileId }).from(tasks).where(eq(tasks.id, id)).get()
      : ref === "match"
        ? services.db
            .select({ profileId: matches.profileId })
            .from(matches)
            .where(eq(matches.id, id))
            .get()
        : services.db
            .select({ profileId: requests.profileId })
            .from(requests)
            .where(eq(requests.id, id))
            .get();
  if (!row?.profileId) throw notFound("That item is not in the queue", "needs_you_not_found");
  return { ref, id, profileId: row.profileId };
}

/** The request an item's timeline belongs to, if it has one. */
export function requestIdOf(services: AppServices, subject: Subject): string | null {
  if (subject.ref === "details") return subject.id;
  if (subject.ref === "match") return null;
  return (
    services.db
      .select({ requestId: tasks.requestId })
      .from(tasks)
      .where(eq(tasks.id, subject.id))
      .get()?.requestId ?? null
  );
}

export const markKey = (mark: NeedsYouMarkRow): string =>
  mark.taskId
    ? `task:${mark.taskId}`
    : mark.matchId
      ? `match:${mark.matchId}`
      : `details:${mark.requestId}`;

export function toMark(key: string, row: NeedsYouMarkRow | undefined): NeedsYouMark {
  return {
    key,
    snoozedUntil: row?.snoozedUntil ?? null,
    openedAt: row?.openedAt ?? null,
    tries: row?.tries ?? 0,
    lastTriedAt: row?.lastTriedAt ?? null,
  };
}

/** The person-side state of the items in the Needs you queue. */
export function createMarks(services: AppServices) {
  const { db, clock } = services;

  function find(ref: NeedsYouRef, id: string): NeedsYouMarkRow | undefined {
    return db.select().from(needsYouMarks).where(eq(SUBJECT_COLUMN[ref], id)).get();
  }

  function change(
    subject: Subject,
    next: (current: NeedsYouMarkRow | undefined) => Partial<NeedsYouMarkRow>,
  ): NeedsYouMark {
    const now = nowIso(clock);
    const current = find(subject.ref, subject.id);
    const fields = { ...next(current), updatedAt: now };
    if (current) {
      db.update(needsYouMarks).set(fields).where(eq(needsYouMarks.id, current.id)).run();
    } else {
      db.insert(needsYouMarks)
        .values({
          id: newId(),
          profileId: subject.profileId,
          [SUBJECT_FIELD[subject.ref]]: subject.id,
          createdAt: now,
          ...fields,
        })
        .run();
    }
    return toMark(`${subject.ref}:${subject.id}`, find(subject.ref, subject.id));
  }

  return {
    find,

    forProfile(profileId: string | undefined): Map<string, NeedsYouMarkRow> {
      const rows = db
        .select()
        .from(needsYouMarks)
        .where(profileId ? eq(needsYouMarks.profileId, profileId) : undefined)
        .all();
      return new Map(rows.map((row) => [markKey(row), row]));
    },

    snooze: (subject: Subject, until: string) => change(subject, () => ({ snoozedUntil: until })),

    unsnooze: (subject: Subject) => change(subject, () => ({ snoozedUntil: null })),

    opened: (subject: Subject) => change(subject, () => ({ openedAt: nowIso(clock) })),

    notYet: (subject: Subject) =>
      change(subject, (current) => ({
        tries: (current?.tries ?? 0) + 1,
        lastTriedAt: nowIso(clock),
        openedAt: null,
      })),

    /** An item that was dealt with no longer asks whether the page worked. */
    clearOpened(ref: NeedsYouRef, id: string): void {
      const current = find(ref, id);
      if (!current?.openedAt) return;
      db.update(needsYouMarks)
        .set({ openedAt: null, updatedAt: nowIso(clock) })
        .where(eq(needsYouMarks.id, current.id))
        .run();
    },
  };
}

export type Marks = ReturnType<typeof createMarks>;
