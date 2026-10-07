import { campaigns } from "@kickrocks/db";
import {
  type CampaignBody,
  type CampaignCreated,
  type CampaignPreview,
  countOutcomes,
  type Reference,
  type TargetOutcome,
} from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { nowIso } from "../../core/clock.js";
import { AppError } from "../../core/errors.js";
import { newId } from "../../core/ids.js";
import type { AppServices } from "../../services.js";
import { type CampaignPlan, createCampaignPlanner, type Plan } from "./planner.js";

/** Shown in the preview where the real reference goes, because no request exists yet. */
const PREVIEW_REFERENCE: Reference = "KR-XXXXXX";

export interface CampaignService {
  preview(profileId: string, body: CampaignBody): CampaignPreview;
  create(profileId: string, body: CampaignBody): CampaignCreated;
}

type Skip = Extract<Plan, { kind: "skip" }>;

const skipped = (plan: Skip): TargetOutcome => ({
  targetId: plan.target.id,
  targetName: plan.target.name,
  outcome: "skipped",
  requestId: null,
  scanId: null,
  reason: plan.reason,
  detail: plan.detail,
});

/**
 * What an attempt to start work turned out to be, when the plan was made from rows that a
 * conflict then contradicted. The planner and the flow read the same data, so this only happens
 * when the two disagree about a rule, and it must end as a skip and not as a failed campaign.
 */
function skipFor(plan: Plan, error: AppError): Skip | null {
  const reasons: Record<string, Skip["reason"]> = {
    mailbox_required: "no_mailbox",
    no_email_address: "no_contact_method",
  };
  const reason = reasons[error.code];
  return reason ? { kind: "skip", target: plan.target, reason, detail: error.message } : null;
}

export function createCampaignService(services: AppServices): CampaignService {
  const { db, clock, composer, requests, dispatch } = services;
  const planner = createCampaignPlanner({
    db,
    clock,
    legal: services.legal,
    targets: services.targets,
    taskQueue: services.taskQueue,
    needsRecord: dispatch.needsRecord,
  });

  function outcomeOf(plan: Plan): TargetOutcome {
    if (plan.kind === "skip") return skipped(plan);
    return {
      targetId: plan.target.id,
      targetName: plan.target.name,
      outcome: plan.kind === "scan" ? "scan_started" : "request_created",
      requestId: null,
      scanId: null,
      reason: null,
      detail: null,
    };
  }

  /** The first email that would go out, composed by the same code that composes the real one. */
  function sampleEmail(plan: CampaignPlan, rights: CampaignBody["rights"]) {
    const first = plan.plans.find(
      (item): item is Extract<Plan, { kind: "request" }> =>
        item.kind === "request" && item.channel === "email",
    );
    if (!first) return null;
    return composer.requestEmail(
      {
        profileId: plan.profile.id,
        targetId: first.target.id,
        rights,
        legalBasis: first.legalBasis,
        reference: PREVIEW_REFERENCE,
        sentAt: null,
        followUps: 0,
        mailboxId: plan.mailboxId,
      },
      "initial",
    ).email;
  }

  return {
    preview(profileId, body) {
      const plan = planner.plan(profileId, body.selection, body.rights);
      const items = plan.plans.map(outcomeOf);
      return {
        items,
        counts: countOutcomes(items),
        sampleEmail: sampleEmail(plan, body.rights),
      };
    },

    create(profileId, body) {
      return db.transaction(() => {
        const plan = planner.plan(profileId, body.selection, body.rights);
        const campaignId = newId();
        db.insert(campaigns)
          .values({
            id: campaignId,
            profileId,
            rights: body.rights,
            selection: body.selection,
            createdCount: 0,
            skipped: [],
            createdAt: nowIso(clock),
          })
          .run();

        const items: TargetOutcome[] = [];
        for (const item of plan.plans) {
          if (item.kind === "skip") {
            items.push(skipped(item));
            continue;
          }
          try {
            // Each start is its own savepoint, so a target that cannot go out leaves no half-made request behind.
            if (item.kind === "scan") {
              const started = dispatch.enqueueScan(profileId, item.target.id);
              items.push(
                started.created
                  ? { ...outcomeOf(item), scanId: started.scanId }
                  : skipped({
                      kind: "skip",
                      target: item.target,
                      reason: "scan_in_progress",
                      detail: `A scan of ${item.target.name} is already running.`,
                    }),
              );
            } else {
              const opened = requests.open({
                profileId,
                targetId: item.target.id,
                rights: body.rights,
                channel: item.channel,
                campaignId,
                actor: "user",
              });
              items.push({ ...outcomeOf(item), requestId: opened.request.id });
            }
          } catch (error) {
            const fallback = error instanceof AppError ? skipFor(item, error) : null;
            if (!fallback) throw error;
            items.push(skipped(fallback));
          }
        }

        const counts = countOutcomes(items);
        db.update(campaigns)
          .set({
            createdCount: counts.request_created,
            skipped: items.filter((item) => item.outcome === "skipped"),
          })
          .where(eq(campaigns.id, campaignId))
          .run();
        return { campaignId, items, counts };
      });
    },
  };
}
