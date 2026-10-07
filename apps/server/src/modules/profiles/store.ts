import {
  type IdentityRow,
  identities,
  type KickRocksDb,
  type MailboxRow,
  mailboxes,
  type ProfileRow,
  profiles,
} from "@kickrocks/db";
import type {
  Identity,
  IdentityInput,
  Mailbox,
  ProfileDetail,
  ProfilePatch,
  ProfileSummary,
  StateCode,
} from "@kickrocks/shared";
import { asc, eq, sql } from "drizzle-orm";
import { type Clock, nowIso } from "../../core/clock.js";
import { notFound } from "../../core/errors.js";
import { loadIdentities } from "../../core/identities.js";
import { newId } from "../../core/ids.js";

export interface ProfileStore {
  list(): ProfileSummary[];
  get(id: string): ProfileDetail;
  create(input: {
    displayName: string;
    state: StateCode;
    identities: IdentityInput[];
  }): ProfileDetail;
  update(id: string, patch: ProfilePatch): ProfileDetail;
  replaceIdentities(id: string, inputs: IdentityInput[]): ProfileDetail;
  remove(id: string): void;
}

function primaryEmailOf(identityList: readonly Identity[]): string | null {
  const emails = identityList.filter((identity) => identity.kind === "email");
  const email = emails.find((identity) => identity.isPrimary) ?? emails[0];
  return email?.kind === "email" ? email.value.address : null;
}

/** The mailbox as the client sees it: never the app password, never the polling cursor. */
export function toMailbox(row: MailboxRow): Mailbox {
  return {
    id: row.id,
    profileId: row.profileId,
    provider: row.provider,
    address: row.address,
    username: row.username,
    smtpHost: row.smtpHost,
    smtpPort: row.smtpPort,
    smtpSecure: row.smtpSecure,
    imapHost: row.imapHost,
    imapPort: row.imapPort,
    replyFolder: row.replyFolder,
    dailyCap: row.dailyCap,
    lastPolledAt: row.lastPolledAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
  };
}

function summarize(
  row: ProfileRow,
  identityList: readonly Identity[],
  mailboxConnected: boolean,
): ProfileSummary {
  return {
    id: row.id,
    displayName: row.displayName,
    state: row.state,
    primaryEmail: primaryEmailOf(identityList),
    mailboxConnected,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Two identities say the same thing when their kind and value match, ignoring letter case. */
export function identityKey(identity: Pick<IdentityInput, "kind" | "value">): string {
  return `${identity.kind}:${JSON.stringify(sortKeys(identity.value)).toLowerCase()}`;
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, entry]) => [key, sortKeys(entry)]),
    );
  }
  return value;
}

function identityValues(profileId: string, id: string, input: IdentityInput) {
  return {
    id,
    profileId,
    kind: input.kind,
    value: input.value,
    isPrimary: input.isPrimary,
    validFrom: input.validFrom,
    validTo: input.validTo,
  };
}

export function createProfileStore(deps: { db: KickRocksDb; clock: Clock }): ProfileStore {
  const { db, clock } = deps;

  const requireRow = (id: string): ProfileRow => {
    const row = db.select().from(profiles).where(eq(profiles.id, id)).get();
    if (!row) throw notFound(`Profile ${id} not found`, "profile_not_found");
    return row;
  };

  const detail = (row: ProfileRow): ProfileDetail => {
    const identityList = loadIdentities(db, row.id);
    const mailbox = db.select().from(mailboxes).where(eq(mailboxes.profileId, row.id)).get();
    return {
      ...summarize(row, identityList, mailbox !== undefined),
      identities: identityList,
      mailbox: mailbox ? toMailbox(mailbox) : null,
    };
  };

  /**
   * Replaces the rows in the order the client sent them, but lets an identity that did not change
   * keep its id. A queued scan names a past name or address by id, so a fresh id on every save
   * would leave that scan searching for nobody.
   */
  const writeIdentities = (profileId: string, inputs: IdentityInput[]): void => {
    const existing: IdentityRow[] = db
      .select()
      .from(identities)
      .where(eq(identities.profileId, profileId))
      .orderBy(asc(sql`rowid`))
      .all();
    const reusable = new Map<string, string[]>();
    for (const row of existing) {
      const key = identityKey(row as Pick<IdentityInput, "kind" | "value">);
      reusable.set(key, [...(reusable.get(key) ?? []), row.id]);
    }
    db.delete(identities).where(eq(identities.profileId, profileId)).run();
    for (const input of inputs) {
      const id = reusable.get(identityKey(input))?.shift() ?? newId();
      db.insert(identities)
        .values(identityValues(profileId, id, input))
        .run();
    }
  };

  const touch = (id: string) =>
    db
      .update(profiles)
      .set({ updatedAt: nowIso(clock) })
      .where(eq(profiles.id, id))
      .run();

  return {
    list() {
      const mailboxProfileIds = new Set(
        db
          .select({ profileId: mailboxes.profileId })
          .from(mailboxes)
          .all()
          .map((m) => m.profileId),
      );
      return db
        .select()
        .from(profiles)
        .orderBy(asc(profiles.createdAt), asc(sql`rowid`))
        .all()
        .map((row) => summarize(row, loadIdentities(db, row.id), mailboxProfileIds.has(row.id)));
    },

    get: (id) => detail(requireRow(id)),

    create(input) {
      const now = nowIso(clock);
      const id = newId();
      db.transaction(() => {
        db.insert(profiles)
          .values({
            id,
            displayName: input.displayName,
            state: input.state,
            createdAt: now,
            updatedAt: now,
          })
          .run();
        writeIdentities(id, input.identities);
      });
      return detail(requireRow(id));
    },

    update(id, patch) {
      db.transaction(() => {
        requireRow(id);
        db.update(profiles)
          .set({
            ...(patch.displayName === undefined ? {} : { displayName: patch.displayName }),
            ...(patch.state === undefined ? {} : { state: patch.state }),
            updatedAt: nowIso(clock),
          })
          .where(eq(profiles.id, id))
          .run();
      });
      return detail(requireRow(id));
    },

    replaceIdentities(id, inputs) {
      db.transaction(() => {
        requireRow(id);
        writeIdentities(id, inputs);
        touch(id);
      });
      return detail(requireRow(id));
    },

    remove(id) {
      requireRow(id);
      db.delete(profiles).where(eq(profiles.id, id)).run();
    },
  };
}
