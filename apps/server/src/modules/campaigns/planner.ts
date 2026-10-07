import {
  type KickRocksDb,
  mailboxes,
  profiles,
  recipes,
  requests,
  type TargetRow,
  targets,
} from "@kickrocks/db";
import type { LegalApi } from "@kickrocks/legal";
import {
  type CampaignPreset,
  type CampaignSelection,
  isActiveStatus,
  type RequestChannel,
  type RequestRight,
  type SkipReason,
  type StateCode,
  type TargetPriority,
} from "@kickrocks/shared";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Clock } from "../../core/clock.js";
import { conflict, notFound } from "../../core/errors.js";
import type { TargetsService } from "../../core/targets.js";
import type { TaskQueue } from "../../core/task-queue.js";

/** What the campaign will do for one target. */
export type Plan =
  | {
      kind: "request";
      target: TargetRow;
      channel: RequestChannel;
      legalBasis: string;
      rights: RequestRight[];
    }
  | { kind: "scan"; target: TargetRow }
  | { kind: "skip"; target: TargetRow; reason: SkipReason; detail: string };

export interface CampaignPlan {
  profile: { id: string; state: StateCode };
  mailboxId: string | null;
  plans: Plan[];
}

/**
 * Requirements that nothing here can carry out for a person: a phone call, a letter, a fax, or a
 * payment. Everything else a site asks for (a CAPTCHA, an account, an ID upload) ends up in the
 * review queue for a person to do.
 */
const OFFLINE_REQUIREMENTS = ["postal_mail", "fax", "phone_call", "paid"] as const;

const OFFLINE_LABELS: Record<(typeof OFFLINE_REQUIREMENTS)[number], string> = {
  postal_mail: "a letter in the post",
  fax: "a fax",
  phone_call: "a phone call",
  paid: "a payment",
};

const PRIORITY_RANK: Record<TargetPriority, number> = { crucial: 0, high: 1, normal: 2 };

export interface CampaignPlannerDeps {
  db: KickRocksDb;
  clock: Clock;
  legal: LegalApi;
  targets: TargetsService;
  taskQueue: TaskQueue;
  needsRecord: (target: { id: string; category: TargetRow["category"] }) => boolean;
}

export interface CampaignPlanner {
  plan(profileId: string, selection: CampaignSelection, rights: RequestRight[]): CampaignPlan;
}

const joinNames = (names: readonly string[]) =>
  names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;

export function createCampaignPlanner({
  db,
  clock,
  legal,
  targets: targetsService,
  taskQueue,
  needsRecord,
}: CampaignPlannerDeps): CampaignPlanner {
  // A people-search site starts from a scan, not from an email, so it is not an email broker here.
  const PRESET_MEMBERS: Record<CampaignPreset, (row: TargetRow) => boolean> = {
    companies: (row) => row.kind === "company",
    email_brokers: (row) => row.kind === "broker" && row.privacyEmail !== null && !needsRecord(row),
    people_search: (row) => needsRecord(row),
    everything: () => true,
  };

  function presetTargets(preset: CampaignPreset): TargetRow[] {
    const live = db.select().from(targets).where(eq(targets.retired, false)).all();
    const selected = live.filter((row) => PRESET_MEMBERS[preset](row));
    return selected.sort(
      (a, b) =>
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        a.name.localeCompare(b.name) ||
        a.id.localeCompare(b.id),
    );
  }

  function explicitTargets(targetIds: readonly string[]): TargetRow[] {
    const ids = [...new Set(targetIds)];
    const found = new Map(
      db
        .select()
        .from(targets)
        .where(inArray(targets.id, ids))
        .all()
        .map((row) => [row.id, row]),
    );
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw notFound(`Unknown target: ${missing.slice(0, 5).join(", ")}`, "target_not_found");
    }
    const retired = ids.map((id) => found.get(id) as TargetRow).filter((row) => row.retired);
    if (retired.length > 0) {
      throw conflict(
        "target_retired",
        `${joinNames(retired.slice(0, 3).map((row) => row.name))} is no longer in the dataset, so nothing new can be sent to it`,
      );
    }
    return ids.map((id) => found.get(id) as TargetRow);
  }

  /** Whether the remove recipe the form task would use types the mailbox address into the form. */
  function formUsesMailbox(row: TargetRow): boolean {
    if (row.requirements.includes("email_confirmation")) return true;
    const usable = db
      .select({ definition: recipes.definition, health: recipes.health })
      .from(recipes)
      .where(
        and(
          eq(recipes.targetId, row.id),
          eq(recipes.purpose, "remove"),
          eq(recipes.status, "active"),
        ),
      )
      .orderBy(desc(recipes.version))
      .all()
      .find((recipe) => recipe.health !== "broken");
    return usable?.definition.fields.includes("email") ?? false;
  }

  /**
   * A group campaign asks companies only to stop selling data. Deleting what a company holds can
   * close an account or erase purchases or genetic data, so it takes a person choosing that company.
   */
  function rightsFor(
    row: TargetRow,
    selection: CampaignSelection,
    rights: RequestRight[],
  ): RequestRight[] {
    return row.kind === "company" && "preset" in selection ? ["opt_out"] : rights;
  }

  function plan(
    profileId: string,
    selection: CampaignSelection,
    chosenRights: RequestRight[],
  ): CampaignPlan {
    const profile = db.select().from(profiles).where(eq(profiles.id, profileId)).get();
    if (!profile) throw notFound(`Profile ${profileId} not found`, "profile_not_found");
    const mailbox = db
      .select({ id: mailboxes.id })
      .from(mailboxes)
      .where(eq(mailboxes.profileId, profileId))
      .get();

    const rows =
      "preset" in selection
        ? presetTargets(selection.preset)
        : explicitTargets(selection.targetIds);

    const history = new Map<string, { active: boolean; confirmed: boolean }>();
    if (rows.length > 0) {
      for (const request of db
        .select({ targetId: requests.targetId, status: requests.status })
        .from(requests)
        .where(eq(requests.profileId, profileId))
        .all()) {
        const entry = history.get(request.targetId) ?? { active: false, confirmed: false };
        entry.active ||= isActiveStatus(request.status);
        entry.confirmed ||= request.status === "confirmed";
        history.set(request.targetId, entry);
      }
    }
    const scanning = new Set(
      taskQueue
        .list({ status: ["queued", "leased", "blocked"], kinds: ["scan", "agent"], profileId })
        .filter(
          (task) =>
            task.kind === "scan" || (task.kind === "agent" && task.payload.purpose === "scan"),
        )
        .flatMap((task) => (task.targetId ? [task.targetId] : [])),
    );

    const asOf = clock.now();
    const plans = rows.map((row): Plan => {
      const skip = (reason: SkipReason, detail: string): Plan => ({
        kind: "skip",
        target: row,
        reason,
        detail,
      });
      const past = history.get(row.id);
      if (past?.active) {
        return skip("already_active", `A request to ${row.name} is already in progress.`);
      }
      if (past?.confirmed) {
        return skip(
          "already_confirmed",
          `${row.name} already confirmed removal. It is asked again only if a re-scan finds you listed.`,
        );
      }
      const summary = targetsService.toSummary(row);
      if (summary.needsRecord && scanning.has(row.id)) {
        return skip("scan_in_progress", `A scan of ${row.name} is already running.`);
      }

      const rights = rightsFor(row, selection, chosenRights);
      const basis = legal.resolveLegalBasis({
        state: profile.state,
        target: summary,
        rights,
        asOf,
      });
      const platform = basis.statute?.platform ?? null;
      if (platform && row.kind === "broker" && summary.californiaRegistered) {
        return skip(
          "covered_by_platform",
          `File one request at ${platform.name} (${platform.url}) to cover ${row.name} and the other registered data brokers. Kick Rocks does not file it for you. ${platform.note}`.trim(),
        );
      }

      const hasEmail = row.privacyEmail !== null;
      const offline = OFFLINE_REQUIREMENTS.filter((requirement) =>
        row.requirements.includes(requirement),
      );
      const hasForm = row.optOutUrl !== null && offline.length === 0;
      if (!hasEmail && !hasForm) {
        if (offline.length > 0) {
          return skip(
            "unsupported_channel",
            `${row.name} only accepts ${joinNames(offline.map((requirement) => OFFLINE_LABELS[requirement]))}, which Kick Rocks cannot send.`,
          );
        }
        return skip(
          "no_contact_method",
          `${row.name} lists no email address and no opt-out form to send a request to.`,
        );
      }

      if (summary.needsRecord) return { kind: "scan", target: row };

      const channel: RequestChannel = hasEmail ? "email" : "form";
      if (!mailbox && (channel === "email" || formUsesMailbox(row))) {
        return skip(
          "no_mailbox",
          channel === "email"
            ? `Connect a mailbox to email ${row.name}.`
            : `${row.name} confirms by email, so connect a mailbox first.`,
        );
      }
      return { kind: "request", target: row, channel, legalBasis: basis.id, rights };
    });

    return {
      profile: { id: profile.id, state: profile.state },
      mailboxId: mailbox?.id ?? null,
      plans,
    };
  }

  return { plan };
}
