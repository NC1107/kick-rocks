import {
  campaigns,
  identities,
  type KickRocksDb,
  mailboxes,
  matches,
  messages,
  outgoingMail,
  profiles,
  requests,
  scans,
  taskArtifacts,
  tasks,
} from "@kickrocks/db";
import { LIVE_TASK_STATUSES, type SettingKey } from "@kickrocks/shared";
import { and, eq, inArray, ne, or, sql } from "drizzle-orm";
import { requireProfile } from "../../core/require-profile.js";
import type { SettingsStore } from "../../core/settings.js";
import type { TaskQueue } from "../../core/task-queue.js";
import { compactDatabase } from "./compact.js";

export interface EraseDeps {
  db: KickRocksDb;
  taskQueue: TaskQueue;
  settings: SettingsStore;
}

type Tx = Parameters<Parameters<KickRocksDb["transaction"]>[0]>[0];

/** Settings that hold the person's choices or credentials, as opposed to the sign-in password. */
const SETTINGS_TO_FORGET: readonly SettingKey[] = [
  "schedule",
  "llm",
  "retention",
  "mcp.enabled",
  "mcp.tokenHash",
  "worker.status.builtin",
  "worker.status.model",
];

/** Tasks that carry no personal data and belong to the recipes, so a reset leaves them alone. */
const NOT_PERSONAL_KIND = "canary";

function profileTaskIds(tx: Tx, profileId: string): string[] {
  const requestIds = tx
    .select({ id: requests.id })
    .from(requests)
    .where(eq(requests.profileId, profileId));
  const mailboxIds = tx
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(eq(mailboxes.profileId, profileId))
    .all()
    .map((row) => row.id);
  const belongsToProfile = or(
    eq(tasks.profileId, profileId),
    inArray(tasks.requestId, requestIds),
    // An inbox poll names the mailbox and not the profile, so it is found by that id.
    mailboxIds.length > 0
      ? and(
          eq(tasks.kind, "inbox_poll"),
          inArray(sql<string>`json_extract(${tasks.payload}, '$.mailboxId')`, mailboxIds),
        )
      : undefined,
  );
  return tx
    .select({ id: tasks.id })
    .from(tasks)
    .where(belongsToProfile)
    .all()
    .map((row) => row.id);
}

/**
 * Cancels before it deletes. A cancelled row cannot be completed, and a deleted one cannot be
 * found, so a worker that still holds a lease finds nothing to report against.
 */
function removeTasks(tx: Tx, taskQueue: TaskQueue, ids: readonly string[]): void {
  for (const id of ids) {
    const task = taskQueue.get(id);
    if (task && (LIVE_TASK_STATUSES as readonly string[]).includes(task.status)) {
      taskQueue.cancel(id, "user");
    }
  }
  if (ids.length === 0) return;
  tx.delete(taskArtifacts)
    .where(inArray(taskArtifacts.taskId, [...ids]))
    .run();
  tx.delete(tasks)
    .where(inArray(tasks.id, [...ids]))
    .run();
}

function removeProfileRows(tx: Tx, taskQueue: TaskQueue, profileId: string): void {
  removeTasks(tx, taskQueue, profileTaskIds(tx, profileId));

  const requestIds = tx
    .select({ id: requests.id })
    .from(requests)
    .where(eq(requests.profileId, profileId));
  const mailboxIds = tx
    .select({ id: mailboxes.id })
    .from(mailboxes)
    .where(eq(mailboxes.profileId, profileId));

  tx.delete(matches).where(eq(matches.profileId, profileId)).run();
  tx.delete(scans).where(eq(scans.profileId, profileId)).run();
  tx.delete(messages)
    .where(or(inArray(messages.mailboxId, mailboxIds), inArray(messages.requestId, requestIds)))
    .run();
  tx.delete(outgoingMail).where(inArray(outgoingMail.mailboxId, mailboxIds)).run();
  // Request events go with their request through the foreign key.
  tx.delete(requests).where(eq(requests.profileId, profileId)).run();
  tx.delete(campaigns).where(eq(campaigns.profileId, profileId)).run();
  tx.delete(mailboxes).where(eq(mailboxes.profileId, profileId)).run();
  tx.delete(identities).where(eq(identities.profileId, profileId)).run();
  tx.delete(profiles).where(eq(profiles.id, profileId)).run();
}

/**
 * Removes a profile and everything recorded about it, then compacts the file. Requests already
 * sent cannot be recalled, and the broker datasets and recipes are not about the person.
 */
export function eraseProfile({ db, taskQueue }: EraseDeps, profileId: string): void {
  db.transaction((tx) => {
    requireProfile(db, profileId);
    removeProfileRows(tx, taskQueue, profileId);
  });
  compactDatabase(db);
}

/**
 * Wipes every profile and the instance settings, and keeps the sign-in password, the broker
 * datasets, and the recipes, so the person can start over without setting the server up again.
 */
export function eraseInstance({ db, taskQueue, settings }: EraseDeps): void {
  db.transaction((tx) => {
    const personal = tx
      .select({ id: tasks.id })
      .from(tasks)
      .where(ne(tasks.kind, NOT_PERSONAL_KIND))
      .all()
      .map((row) => row.id);
    removeTasks(tx, taskQueue, personal);
    for (const { id } of tx.select({ id: profiles.id }).from(profiles).all()) {
      removeProfileRows(tx, taskQueue, id);
    }
    // Rows no profile owns should not exist, but a reset is the one place that must not trust that.
    tx.delete(matches).run();
    tx.delete(scans).run();
    tx.delete(messages).run();
    tx.delete(outgoingMail).run();
    tx.delete(requests).run();
    tx.delete(campaigns).run();
    tx.delete(mailboxes).run();
    for (const key of SETTINGS_TO_FORGET) settings.reset(key);
  });
  compactDatabase(db);
}
