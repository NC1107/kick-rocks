import {
  type CampaignRow,
  campaigns,
  identities,
  type MailboxRow,
  mailboxes,
  type ProfileRow,
  profiles,
  type RecipeRow,
  recipes,
  requests,
  type TargetRow,
  targets,
} from "@kickrocks/db";
import type {
  Broker,
  Company,
  Identity,
  IdentityInput,
  RecipeHealth,
  RecipeInput,
  RecipeSource,
  RecipeStatus,
  RequestChannel,
  RequestRecord,
  RequestRight,
  RequestStatus,
  StateCode,
} from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { nowIso } from "../core/clock.js";
import { loadIdentities } from "../core/identities.js";
import { newId } from "../core/ids.js";
import { definedOnly } from "../core/objects.js";
import type { RequestPatch } from "../core/requests.js";
import { targetValues } from "../core/targets.js";
import type { AppServices } from "../services.js";
import { jordanIdentities, makeBroker, makeCompany, makeRecipe } from "./builders.js";

/** What the factories need; a test context satisfies it. */
export interface Seeder {
  services: AppServices;
}

export interface SeededProfile extends ProfileRow {
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

export interface SeedRequestInput extends RequestPatch {
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
