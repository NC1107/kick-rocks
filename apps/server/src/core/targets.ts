import { readFileSync } from "node:fs";
import { isTrustedConfirmationDomain } from "@kickrocks/brokers";
import { type KickRocksDb, type TargetRow, targets } from "@kickrocks/db";
import {
  Broker,
  Company,
  needsRecord,
  replyAddressesOf,
  replyDomainsOf,
  type TargetKind,
  type TargetSummary,
  withoutSharedHosts,
} from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { type Clock, nowIso } from "./clock.js";
import { notFound } from "./errors.js";
import type { Logger } from "./logger.js";

export interface DatasetSnapshot<T> {
  /** Identifies this build of the dataset, stored on every target it produced. */
  version: string;
  records: T[];
}

/** Where the datasets come from. A source that returns null is unavailable, not empty. */
export interface TargetSources {
  brokers(): DatasetSnapshot<Broker> | null;
  companies(): DatasetSnapshot<Company> | null;
}

export interface SyncResult {
  added: number;
  updated: number;
  retired: number;
  total: number;
}

/** Targets in `KICKROCKS_EXTRA_TARGETS`: fixtures and the additions of power users. */
export const ExtraTargets = z.object({
  brokers: z.array(Broker).default([]),
  companies: z.array(Company).default([]),
});
export type ExtraTargets = z.infer<typeof ExtraTargets>;

export const EXTRA_DATASET_VERSION = "extra";

export interface TargetsService {
  /**
   * Upserts the broker and company datasets and the extra targets, and retires targets that
   * no longer appear. Retired rows are kept so request history stays meaningful.
   */
  sync(): SyncResult;
  get(id: string): TargetRow | null;
  getOrThrow(id: string): TargetRow;
  toSummary(row: TargetRow): TargetSummary;
  /** The summary of a target by id, for claims and listings. */
  summary(id: string): TargetSummary;
}

export interface TargetsDeps {
  db: KickRocksDb;
  clock: Clock;
  logger: Logger;
  sources: TargetSources;
  extraTargetsPath: string | null;
}

type TargetRecord = { kind: "broker"; record: Broker } | { kind: "company"; record: Company };
type TargetValues = Omit<TargetRow, "createdAt" | "retired" | "datasetVersion">;

/** The sites a people-search campaign and scan cover: brokers that remove a specific record. */
export function isPeopleSearchTarget(row: Pick<TargetRow, "id" | "kind" | "category">): boolean {
  return row.kind === "broker" && needsRecord(row);
}

export function toTargetSummary(row: TargetRow): TargetSummary {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    category: row.category,
    domain: row.domain,
    website: row.website,
    optOutUrl: row.optOutUrl,
    privacyRightsUrl: row.privacyRightsUrl,
    searchUrl: row.searchUrl,
    contactMethod: row.contactMethod,
    requiresId: row.requiresId,
    requirements: row.requirements,
    priority: row.priority,
    needsRecord: needsRecord({ id: row.id, category: row.category }),
    californiaRegistered: row.data.sources.some((source) => source.source === "ca-registry-2026"),
    retired: row.retired,
  };
}

/** The reply domains of a stored target, from its own columns and the dataset's explicit list. */
export function replyDomainsOfRow(row: TargetRow): string[] {
  const listed = "replyDomains" in row.data ? row.data.replyDomains : undefined;
  return replyDomainsOf({ ...row, replyDomains: listed });
}

/** Only the sister domains the dataset curates for a stored target, without its own contact hosts. */
export function curatedReplyDomainsOfRow(row: TargetRow): string[] {
  const listed = "replyDomains" in row.data ? row.data.replyDomains : undefined;
  return withoutSharedHosts(listed ?? []);
}

/**
 * Whether mail from `domain` may confirm a removal for a stored target: its own organization or a
 * sister domain the dataset curates for it, and never a shared host.
 */
export function isTrustedConfirmationSender(target: TargetRow, domain: string): boolean {
  return isTrustedConfirmationDomain(domain, target.domain, curatedReplyDomainsOfRow(target));
}

/** The exact sender addresses trusted for a stored target whose mailbox is on a shared host. */
export function replyAddressesOfRow(row: TargetRow): string[] {
  return replyAddressesOf(row);
}

/** Columns derived from a dataset record. Companies have no region, requirements, or priority. */
export function targetValues(target: TargetRecord): TargetValues {
  if (target.kind === "broker") {
    const b = target.record;
    return {
      id: b.id,
      kind: "broker",
      name: b.name,
      category: b.category,
      domain: b.domain,
      website: b.website,
      privacyEmail: b.privacyEmail,
      optOutUrl: b.optOutUrl,
      privacyRightsUrl: b.privacyRightsUrl,
      searchUrl: b.searchUrl,
      contactMethod: b.contactMethod,
      region: b.region,
      requiresId: b.requiresId,
      requirements: b.requirements,
      priority: b.priority,
      data: b,
    };
  }
  const c = target.record;
  return {
    id: c.id,
    kind: "company",
    name: c.name,
    category: c.category,
    domain: c.domain,
    website: `https://${c.domain}`,
    privacyEmail: c.privacyEmail,
    optOutUrl: c.optOutUrl,
    privacyRightsUrl: c.privacyRightsUrl,
    searchUrl: null,
    contactMethod: c.contactMethod,
    region: "us",
    requiresId: false,
    requirements: [],
    priority: "normal",
    data: c,
  };
}

function loadExtraTargets(path: string): ExtraTargets {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read KICKROCKS_EXTRA_TARGETS at ${path}: ${(error as Error).message}`);
  }
  const parsed = ExtraTargets.safeParse(json);
  if (!parsed.success) {
    throw new Error(
      `KICKROCKS_EXTRA_TARGETS at ${path} is invalid: ${z.prettifyError(parsed.error)}`,
    );
  }
  return parsed.data;
}

interface Desired {
  values: TargetValues;
  version: string;
}

export function createTargetsService({
  db,
  clock,
  logger,
  sources,
  extraTargetsPath,
}: TargetsDeps): TargetsService {
  function collect(): { desired: Desired[]; syncedKinds: Set<TargetKind> } {
    const byKey = new Map<string, Desired>();
    const syncedKinds = new Set<TargetKind>();
    const add = (target: TargetRecord, version: string) => {
      const values = targetValues(target);
      byKey.set(`${values.kind}:${values.domain}`, { values, version });
    };

    const brokers = sources.brokers();
    if (brokers) {
      syncedKinds.add("broker");
      for (const record of brokers.records) add({ kind: "broker", record }, brokers.version);
    } else {
      logger.warn(
        'Broker dataset is unavailable; run "pnpm data:build". Existing brokers are kept.',
      );
    }
    const companies = sources.companies();
    if (companies) {
      syncedKinds.add("company");
      for (const record of companies.records) add({ kind: "company", record }, companies.version);
    }
    if (extraTargetsPath) {
      const extra = loadExtraTargets(extraTargetsPath);
      for (const record of extra.brokers) add({ kind: "broker", record }, EXTRA_DATASET_VERSION);
      for (const record of extra.companies) add({ kind: "company", record }, EXTRA_DATASET_VERSION);
    }

    const desired = Array.from(byKey.values());
    const owners = new Map<string, Desired>();
    for (const entry of desired) {
      const other = owners.get(entry.values.id);
      if (other) {
        throw new Error(
          `Target id "${entry.values.id}" is used by ${other.values.kind} ${other.values.domain} and ${entry.values.kind} ${entry.values.domain}`,
        );
      }
      owners.set(entry.values.id, entry);
    }
    return { desired, syncedKinds };
  }

  function getOrThrow(id: string): TargetRow {
    const row = db.select().from(targets).where(eq(targets.id, id)).get();
    if (!row) throw notFound(`Target ${id} not found`, "target_not_found");
    return row;
  }

  return {
    sync() {
      const { desired, syncedKinds } = collect();
      const now = nowIso(clock);
      return db.transaction((tx) => {
        const existing = new Map(
          tx
            .select()
            .from(targets)
            .all()
            .map((row) => [row.id, row]),
        );
        const wanted = new Set(desired.map((entry) => entry.values.id));
        const result: SyncResult = { added: 0, updated: 0, retired: 0, total: desired.length };

        // Retire first so a record that moved to a new id can take over the old one's domain.
        for (const row of existing.values()) {
          if (!row.retired && !wanted.has(row.id) && syncedKinds.has(row.kind)) {
            tx.update(targets).set({ retired: true }).where(eq(targets.id, row.id)).run();
            result.retired += 1;
          }
        }

        for (const { values, version } of desired) {
          const current = existing.get(values.id);
          if (!current) {
            tx.insert(targets)
              .values({ ...values, datasetVersion: version, retired: false, createdAt: now })
              .run();
            result.added += 1;
            continue;
          }
          const unchanged =
            !current.retired &&
            current.datasetVersion === version &&
            JSON.stringify(current.data) === JSON.stringify(values.data);
          if (unchanged) continue;
          tx.update(targets)
            .set({ ...values, datasetVersion: version, retired: false })
            .where(eq(targets.id, values.id))
            .run();
          result.updated += 1;
        }
        return result;
      });
    },

    get(id) {
      return db.select().from(targets).where(eq(targets.id, id)).get() ?? null;
    },

    getOrThrow,

    toSummary: toTargetSummary,

    summary(id) {
      return toTargetSummary(getOrThrow(id));
    },
  };
}

/**
 * A timeline event as the person should read it. A confirmation wait stored before the sender rule
 * existed can name a sender the server now ignores, and the person should not be told to wait for
 * mail that will never be matched.
 */
export function withTrustedConfirmationSenders<
  E extends { type: string; payload: Record<string, unknown> },
>(event: E, target: TargetRow): E {
  const named = event.payload.fromDomains;
  if (event.type !== "awaiting_confirmation" || !Array.isArray(named)) return event;
  const fromDomains = named.filter(
    (domain): domain is string =>
      typeof domain === "string" && isTrustedConfirmationSender(target, domain),
  );
  return { ...event, payload: { ...event.payload, fromDomains } };
}
