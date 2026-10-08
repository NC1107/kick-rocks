import {
  type CampaignRow,
  campaigns,
  identities,
  type MailboxRow,
  type MatchRow,
  type MessageRow,
  mailboxes,
  matches,
  messages,
  type ProfileRow,
  profiles,
  type RecipeRow,
  recipes,
  requests,
  type ScanRow,
  scans,
  type TargetRow,
  targets,
  taskArtifacts,
  tasks,
} from "@kickrocks/db";
import {
  type BlockedReason,
  type Broker,
  type Candidate,
  type Company,
  type FailureKind,
  type Identity,
  type IdentityInput,
  type MatchDecision,
  type MatchFields,
  type ProfileField,
  parseTaskPayload,
  type RecipeHealth,
  type RecipeInput,
  type RecipeSource,
  type RecipeStatus,
  type ReplyClassification,
  type RequestChannel,
  type RequestRecord,
  type RequestRight,
  type RequestStatus,
  type StateCode,
  type TaskKind,
  type TaskPayloadMap,
  type TaskStatus,
} from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { nowIso } from "../core/clock.js";
import { loadIdentities } from "../core/identities.js";
import { newId } from "../core/ids.js";
import { definedOnly } from "../core/objects.js";
import type { RequestPatch } from "../core/requests.js";
import { targetValues } from "../core/targets.js";
import { TASK_PRIORITY } from "../core/task-queue.js";
import type { Task } from "../core/task-types.js";
import type { AppServices } from "../services.js";
import { jordanIdentities, makeBroker, makeCompany, makeRecipe } from "./builders.js";

/** What the factories need; a test context satisfies it. */
interface Seeder {
  services: AppServices;
}

interface SeededProfile extends ProfileRow {
  identities: Identity[];
}

/** Replaces a profile's identities. Defaults to Jordan Example, who has one of each kind. */
export function seedIdentities(
  { services }: Seeder,
  profileId: string,
  inputs: IdentityInput[] = jordanIdentities(),
): Identity[] {
  services.db.transaction((tx) => {
    tx.delete(identities).where(eq(identities.profileId, profileId)).run();
    for (const input of inputs) {
      tx.insert(identities)
        .values({
          id: newId(),
          profileId,
          kind: input.kind,
          value: input.value,
          isPrimary: input.isPrimary,
          validFrom: input.validFrom,
          validTo: input.validTo,
        })
        .run();
    }
  });
  return loadIdentities(services.db, profileId);
}

export function seedProfile(
  seeder: Seeder,
  overrides: {
    displayName?: string;
    state?: StateCode;
    identities?: IdentityInput[];
  } = {},
): SeededProfile {
  const now = nowIso(seeder.services.clock);
  const row = seeder.services.db
    .insert(profiles)
    .values({
      id: newId(),
      displayName: overrides.displayName ?? "Jordan Example",
      state: overrides.state ?? "TX",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return { ...row, identities: seedIdentities(seeder, row.id, overrides.identities) };
}

export function seedMailbox(
  { services }: Seeder,
  profileId: string,
  overrides: Partial<Omit<MailboxRow, "id" | "profileId" | "createdAt">> = {},
): MailboxRow {
  return services.db
    .insert(mailboxes)
    .values({
      id: newId(),
      profileId,
      provider: "other",
      address: "jordan@example.com",
      username: "jordan@example.com",
      secret: "fake-app-password",
      smtpHost: "smtp.example.test",
      smtpPort: 587,
      smtpSecure: false,
      imapHost: "imap.example.test",
      imapPort: 993,
      replyFolder: "INBOX",
      dailyCap: 30,
      createdAt: nowIso(services.clock),
      ...overrides,
    })
    .returning()
    .get();
}

type SeedTargetInput =
  | ({ kind?: "broker" } & Partial<Broker>)
  | ({ kind: "company" } & Partial<Company>);

/** Inserts a target directly, without going through a dataset sync. Defaults to a marketing broker. */
export function seedTarget({ services }: Seeder, input: SeedTargetInput = {}): TargetRow {
  const values =
    input.kind === "company"
      ? targetValues({ kind: "company", record: makeCompany(withoutKind(input)) })
      : targetValues({ kind: "broker", record: makeBroker(withoutKind(input)) });
  return services.db
    .insert(targets)
    .values({
      ...values,
      datasetVersion: "test",
      retired: false,
      createdAt: nowIso(services.clock),
    })
    .returning()
    .get();
}

function withoutKind<T extends { kind?: string }>(input: T): Omit<T, "kind"> {
  const { kind: _kind, ...rest } = input;
  return rest;
}

export function seedRecipe(
  { services }: Seeder,
  targetId: string,
  overrides: {
    purpose?: "scan" | "remove";
    version?: number;
    definition?: Partial<RecipeInput>;
    status?: RecipeStatus;
    health?: RecipeHealth;
    source?: RecipeSource;
    failureCount?: number;
  } = {},
): RecipeRow {
  const definition = makeRecipe({
    brokerId: targetId,
    ...(overrides.purpose ? { purpose: overrides.purpose } : {}),
    ...(overrides.version ? { version: overrides.version } : {}),
    ...(overrides.definition ? { definition: overrides.definition } : {}),
  });
  return services.db
    .insert(recipes)
    .values({
      id: definition.id,
      targetId,
      purpose: definition.purpose,
      version: definition.version,
      definition,
      source: overrides.source ?? "bundled",
      status: overrides.status ?? "active",
      health: overrides.health ?? "unknown",
      failureCount: overrides.failureCount ?? 0,
      createdAt: nowIso(services.clock),
    })
    .returning()
    .get();
}

interface SeedRequestInput extends RequestPatch {
  profileId: string;
  targetId: string;
  status?: RequestStatus;
  channel?: RequestChannel;
  rights?: RequestRight[];
  legalBasis?: string;
  campaignId?: string | null;
}

/**
 * Creates a request, then puts it in the wanted status directly. That skips the state machine
 * on purpose, so a test can start from any status without walking there.
 */
export function seedRequest({ services }: Seeder, input: SeedRequestInput): RequestRecord {
  const { status = "draft", profileId, targetId, rights, legalBasis, campaignId, ...patch } = input;
  const created = services.requests.create({
    profileId,
    targetId,
    rights: rights ?? ["opt_out"],
    legalBasis: legalBasis ?? "policy",
    channel: input.channel ?? "email",
    campaignId: campaignId ?? null,
  });
  return services.db
    .update(requests)
    .set({ ...definedOnly(patch), status, updatedAt: nowIso(services.clock) })
    .where(eq(requests.id, created.id))
    .returning()
    .get();
}

/** A campaign row for tests that need requests to belong to one. */
export function seedCampaign({ services }: Seeder, profileId: string): CampaignRow {
  return services.db
    .insert(campaigns)
    .values({
      id: newId(),
      profileId,
      rights: ["opt_out"],
      selection: { preset: "everything" },
      createdCount: 0,
      skipped: [],
      createdAt: nowIso(services.clock),
    })
    .returning()
    .get();
}

interface SeedMessageInput {
  mailboxId: string;
  requestId?: string | null;
  classification?: ReplyClassification;
  confidence?: number;
  fromAddress?: string;
  subject?: string;
  receivedAt?: string;
  links?: string[];
  requestedFields?: ProfileField[];
  rationale?: string | null;
  snippet?: string | null;
  text?: string | null;
  reviewed?: boolean;
  imapUid?: number;
  uidValidity?: number;
}

let messageUid = 0;

/** A stored message. Defaults to an unreviewed, unclassified one waiting in the review queue. */
export function seedMessage({ services }: Seeder, input: SeedMessageInput): MessageRow {
  messageUid += 1;
  const uid = input.imapUid ?? messageUid;
  return services.db
    .insert(messages)
    .values({
      id: newId(),
      mailboxId: input.mailboxId,
      imapUid: uid,
      uidValidity: input.uidValidity ?? 1,
      requestId: input.requestId ?? null,
      messageIdHeader: `<seed-${uid}@broker.test>`,
      inReplyTo: null,
      fromAddress: input.fromAddress ?? "privacy@broker.test",
      subject: input.subject ?? "Re: your request",
      receivedAt: input.receivedAt ?? nowIso(services.clock),
      classification: input.classification ?? "unknown",
      confidence: input.confidence ?? 0,
      rationale: input.rationale ?? null,
      links: input.links ?? [],
      requestedFields: input.requestedFields ?? [],
      snippet: input.snippet ?? null,
      text: input.text ?? null,
      reviewed: input.reviewed ?? false,
      createdAt: nowIso(services.clock),
    })
    .returning()
    .get();
}

interface SeedScanInput {
  profileId: string;
  targetId: string;
  taskId?: string | null;
  candidates?: Candidate[] | null;
  finishedAt?: string | null;
  error?: string | null;
}

/** A scan row. Defaults to one that is still running. */
export function seedScan({ services }: Seeder, input: SeedScanInput): ScanRow {
  return services.db
    .insert(scans)
    .values({
      id: newId(),
      profileId: input.profileId,
      targetId: input.targetId,
      taskId: input.taskId ?? null,
      startedAt: nowIso(services.clock),
      finishedAt: input.finishedAt ?? null,
      candidates: input.candidates ?? null,
      error: input.error ?? null,
    })
    .returning()
    .get();
}

interface SeedMatchInput {
  scanId: string;
  profileId: string;
  targetId: string;
  recordUrl?: string;
  fields?: MatchFields;
  decision?: MatchDecision;
  requestId?: string | null;
}

let matchSequence = 0;

/** A record a scan found. Defaults to one still waiting for the person to decide. */
export function seedMatch({ services }: Seeder, input: SeedMatchInput): MatchRow {
  matchSequence += 1;
  return services.db
    .insert(matches)
    .values({
      id: newId(),
      scanId: input.scanId,
      profileId: input.profileId,
      targetId: input.targetId,
      recordUrl: input.recordUrl ?? `https://records.test/p/${matchSequence}`,
      fields: input.fields ?? { name: "Jordan Example", locations: ["Austin, TX"] },
      decision: input.decision ?? "pending",
      decidedAt: input.decision && input.decision !== "pending" ? nowIso(services.clock) : null,
      requestId: input.requestId ?? null,
    })
    .returning()
    .get();
}

/** A one pixel PNG, enough to stand for the screenshot a worker attaches to a block. */
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

interface SeedTaskInput<K extends TaskKind = TaskKind> {
  kind: K;
  payload: TaskPayloadMap[K];
  /** Defaults to `queued`. */
  status?: TaskStatus;
  profileId?: string | null;
  targetId?: string | null;
  requestId?: string | null;
  priority?: number;
  dedupeKey?: string | null;
  attempts?: number;
  maxAttempts?: number;
  runAfter?: string | null;
  /** For `leased`: who holds it and until when. Defaults to `seed-worker` for five minutes. */
  leaseOwner?: string;
  leaseExpiresAt?: string;
  /** For `blocked`. */
  blockedReason?: BlockedReason;
  blockedDetail?: string | null;
  blockedUrl?: string | null;
  /** Attach a screenshot, as a worker does when it blocks. */
  screenshot?: boolean | { mime: "image/png" | "image/jpeg"; data: Buffer };
  /** For `failed`. */
  lastError?: string | null;
  failureKind?: FailureKind | null;
  /** For `done`. */
  result?: unknown;
}

/**
 * A task in the state a test needs, inserted directly so no handler runs and no event is written.
 * The payload is validated like the queue would. A leased task gets a lease that runs five minutes
 * from the fake clock, a blocked one a reason, and `screenshot` attaches an artifact.
 */
export function seedTask<K extends TaskKind>({ services }: Seeder, input: SeedTaskInput<K>): Task {
  const status = input.status ?? "queued";
  const now = nowIso(services.clock);
  const row = services.db
    .insert(tasks)
    .values({
      id: newId(),
      kind: input.kind,
      status,
      priority: input.priority ?? TASK_PRIORITY[input.kind],
      profileId: input.profileId ?? null,
      targetId: input.targetId ?? null,
      requestId: input.requestId ?? null,
      payload: parseTaskPayload(input.kind, input.payload),
      result: status === "done" ? (input.result ?? null) : null,
      blockedReason: status === "blocked" ? (input.blockedReason ?? "captcha") : null,
      blockedDetail: status === "blocked" ? (input.blockedDetail ?? null) : null,
      blockedUrl: status === "blocked" ? (input.blockedUrl ?? null) : null,
      leaseOwner: status === "leased" ? (input.leaseOwner ?? "seed-worker") : null,
      leaseExpiresAt:
        status === "leased"
          ? (input.leaseExpiresAt ??
            new Date(services.clock.now().getTime() + 300_000).toISOString())
          : null,
      attempts: input.attempts ?? (status === "queued" ? 0 : 1),
      maxAttempts: input.maxAttempts ?? 3,
      runAfter: input.runAfter ?? null,
      dedupeKey: input.dedupeKey ?? null,
      lastError: input.lastError ?? null,
      failureKind: input.failureKind ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  if (input.screenshot) {
    const shot =
      input.screenshot === true ? { mime: "image/png" as const, data: TINY_PNG } : input.screenshot;
    services.db
      .insert(taskArtifacts)
      .values({
        id: newId(),
        taskId: row.id,
        kind: "screenshot",
        mime: shot.mime,
        data: shot.data,
        createdAt: now,
      })
      .run();
  }
  return services.taskQueue.getOrThrow(row.id);
}

/**
 * Leases a queued task to a worker through the real queue, so a test that needs "a worker holds
 * this" gets the same lease a claim would make. Throws when the task is not queued and due.
 */
export function leaseAs(
  { services }: Seeder,
  taskId: string,
  workerId: string,
  leaseMs = 300_000,
): Task {
  const task = services.taskQueue.getOrThrow(taskId);
  const leased = services.taskQueue.claim({ workerId, kinds: [task.kind], leaseMs, taskId });
  if (!leased) throw new Error(`Task ${taskId} is ${task.status}, so it cannot be leased`);
  return leased;
}
