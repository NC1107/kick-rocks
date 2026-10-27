import {
  API_ROUTES,
  type CampaignPreview,
  type CampaignSelection,
  type CampaignSummary,
  countOutcomes,
  isActiveStatus,
  type RenderedEmail,
  type RequestRight,
  type RequestStatus,
  type Requirement,
  type SkipReason,
  type TargetDetail,
  type TargetOutcome,
} from "@kickrocks/shared";
import { defineMockDomain, handle, notFound } from "./core.js";
import { buildRequest } from "./requests.js";
import { createScan } from "./review.js";
import type { MockStore } from "./store.js";
import { assessed, selectedByFilter } from "./targets.js";

function targetsFor(store: MockStore, selection: CampaignSelection): TargetDetail[] {
  if ("targetIds" in selection) {
    return selection.targetIds.map((id) => {
      const target = store.targets.find((candidate) => candidate.id === id);
      if (!target) throw notFound(`Target "${id}"`);
      return target;
    });
  }
  if ("filter" in selection) return selectedByFilter(store, selection.filter);
  switch (selection.preset) {
    case "easy":
      return store.targets.filter((target) => assessed(target).difficulty === "easy");
    case "companies":
      return store.targets.filter((target) => target.kind === "company");
    case "email_brokers":
      return store.targets.filter(
        (target) =>
          target.kind === "broker" &&
          (target.contactMethod === "email" || target.contactMethod === "both"),
      );
    case "people_search":
      return store.targets.filter(
        (target) => target.category === "people-search" || target.category === "background-check",
      );
    case "everything":
      return store.targets;
  }
}

/** The server's calendar days for 15 business days, the CCPA deadline for a request that only opts out. */
const OPT_OUT_ONLY_DAYS = 21;

/** Channels a person has to use by post, fax, phone, or card, which Kick Rocks does not drive. */
const MANUAL_ONLY: readonly Requirement[] = ["postal_mail", "fax", "phone_call", "paid"];

/** Mirrors the server's planner: only a hand-picked company is asked to delete. */
function rightsFor(
  target: TargetDetail,
  selection: CampaignSelection,
  rights: RequestRight[],
): RequestRight[] {
  return target.kind === "company" && !("targetIds" in selection) ? ["opt_out"] : rights;
}

function outcomeFor(store: MockStore, profileId: string, target: TargetDetail): TargetOutcome {
  const base = {
    targetId: target.id,
    targetName: target.name,
    requestId: null,
    scanId: null,
    detail: null,
  };
  const skipped = (reason: SkipReason, detail: string | null = null): TargetOutcome => ({
    ...base,
    outcome: "skipped",
    reason,
    detail,
  });
  const profile = store.profiles.find((candidate) => candidate.id === profileId);
  const own = store.requests.filter(
    (request) => request.profileId === profileId && request.targetId === target.id,
  );
  if (own.some((request) => isActiveStatus(request.status))) return skipped("already_active");
  if (own.some((request) => request.status === "confirmed")) {
    return skipped(
      "already_confirmed",
      "It confirmed a removal. Nothing is sent again unless a re-scan finds you listed again.",
    );
  }
  if (profile?.state === "CA" && target.californiaRegistered) {
    return skipped(
      "covered_by_platform",
      "California's DROP platform handles registered brokers for California residents.",
    );
  }
  const emailCapable = target.contactMethod === "email" || target.contactMethod === "both";
  const manual = target.requirements.filter((requirement) => MANUAL_ONLY.includes(requirement));
  if (!emailCapable && manual.length > 0) {
    return skipped(
      "unsupported_channel",
      `It only takes requests by ${manual.map((r) => r.replace("_", " ")).join(" or ")}.`,
    );
  }
  if (target.needsRecord) {
    const hasAddress = (profile?.identities ?? []).some((identity) => identity.kind === "address");
    if (!hasAddress) {
      return skipped(
        "missing_profile_details",
        `Add a current address with city and state to this profile to scan ${target.name}.`,
      );
    }
    const scanning = store.scans.some(
      (scan) =>
        scan.profileId === profileId && scan.targetId === target.id && scan.finishedAt === null,
    );
    return scanning
      ? skipped("scan_in_progress")
      : { ...base, outcome: "scan_started", reason: null };
  }
  if (target.contactMethod === "unknown") return skipped("no_contact_method");
  if (emailCapable && !profile?.mailbox) {
    return skipped("no_mailbox", "This profile has no mailbox connected to send from.");
  }
  return { ...base, outcome: "request_created", reason: null };
}

const RIGHT_BASIS: Record<RequestRight, string> = {
  opt_out: "the right to opt out of the sale or sharing of my personal information",
  delete: "the right to ask you to delete the personal information you hold about me",
};

const RIGHT_PHRASES: Record<RequestRight, string> = {
  opt_out: "stop selling or sharing my personal information",
  delete: "delete the personal information you hold about me",
};

function sampleEmail(
  store: MockStore,
  profileId: string,
  target: TargetDetail,
  rights: RequestRight[],
): RenderedEmail {
  const profile = store.profiles.find((candidate) => candidate.id === profileId);
  const name = profile?.displayName ?? "Jordan Example";
  const basis =
    profile?.state === "CA"
      ? `I live in California. Under the California Consumer Privacy Act, I have ${rights.map((right) => RIGHT_BASIS[right]).join(" and ")}. I'm asking you to honor that here, as far as that law applies to you.`
      : "I'm asking you to honor this under your own published privacy commitments.";
  const verification = rights.includes("opt_out")
    ? "Please do not ask for ID, an account, or a fee to stop selling my data."
    : "If you need to check it's really me before deleting, tell me what you need and why, and I'll decide what to send.";
  const asks = rights.map((right) => RIGHT_PHRASES[right]).join(", and ");
  const title =
    rights.length === 2
      ? "Opt-out and deletion request"
      : rights[0] === "opt_out"
        ? "Opt-out request"
        : "Deletion request";
  return {
    subject: `${title} (KR-7H3K2M)`,
    text: [
      `Hello ${target.name},`,
      "",
      "This is about my own personal information. I am the person it describes, and I am asking for myself from my own email address.",
      "",
      `Please ${asks}.`,
      "",
      basis,
      "If you need me to go through a form instead, send me the link and I'll do it myself.",
      "",
      "Here is how to find me:",
      `Name: ${name}`,
      `Email: ${profile?.primaryEmail ?? "jordan@example.org"}`,
      "",
      verification,
      "",
      "Please reply to confirm within 45 days of receiving this email.",
      "",
      "Thanks,",
      name,
      "Reference: KR-7H3K2M",
    ].join("\n"),
  };
}

export default defineMockDomain({
  name: "campaigns",

  routes: (store) => {
    const profileOf = (id: string) => {
      const profile = store.profiles.find((candidate) => candidate.id === id);
      if (!profile) throw notFound("That profile");
      return profile;
    };
    return [
      handle(API_ROUTES.campaignsList, ({ params }) => {
        const profile = profileOf(params.id);
        const batches = new Map<string, CampaignSummary>();
        for (const request of store.requests) {
          if (request.profileId !== profile.id || !request.campaignId) continue;
          const batch = batches.get(request.campaignId) ?? {
            id: request.campaignId,
            createdAt: request.createdAt,
            rights: request.rights,
            requestCount: 0,
            counts: {},
          };
          batch.requestCount += 1;
          batch.createdAt =
            request.createdAt < batch.createdAt ? request.createdAt : batch.createdAt;
          const status: RequestStatus = request.status;
          batch.counts[status] = (batch.counts[status] ?? 0) + 1;
          batches.set(request.campaignId, batch);
        }
        return {
          campaigns: [...batches.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
        };
      }),

      handle(API_ROUTES.campaignsPreview, ({ params, body }): CampaignPreview => {
        const profile = profileOf(params.id);
        const targets = targetsFor(store, body.selection);
        const items = targets.map((target) => outcomeFor(store, profile.id, target));
        const takesEmail = (target: TargetDetail | undefined) =>
          target?.contactMethod === "email" || target?.contactMethod === "both";
        const firstTarget = items
          .filter((item) => item.outcome === "request_created")
          .map((item) => targets.find((target) => target.id === item.targetId))
          .find(takesEmail);
        return {
          items,
          counts: countOutcomes(items),
          basis: items.some((item) => item.outcome === "request_created")
            ? {
                kind: "statute",
                name: "California Consumer Privacy Act",
                citation: "Cal. Civ. Code 1798.100 et seq.",
                responseDays: body.rights.every((right) => right === "opt_out")
                  ? OPT_OUT_ONLY_DAYS
                  : 45,
              }
            : null,
          sampleEmail: firstTarget
            ? sampleEmail(
                store,
                profile.id,
                firstTarget,
                rightsFor(firstTarget, body.selection, body.rights),
              )
            : null,
        };
      }),

      handle(API_ROUTES.campaignsCreate, ({ params, body }) => {
        const profile = profileOf(params.id);
        const targets = targetsFor(store, body.selection);
        const planned = targets.map((target) => outcomeFor(store, profile.id, target));

        const campaignId = store.nextId("cmp");
        const items = planned.map((item): TargetOutcome => {
          if (item.outcome === "request_created") {
            const target = targets.find((candidate) => candidate.id === item.targetId);
            const request = buildRequest(store, {
              profileId: profile.id,
              targetId: item.targetId,
              channel: target?.contactMethod === "form" ? "form" : "email",
              rights: target ? rightsFor(target, body.selection, body.rights) : body.rights,
              status: "queued",
              createdDaysAgo: 0,
              campaignId,
            });
            return { ...item, requestId: request.id };
          }
          if (item.outcome === "scan_started") {
            const scan = createScan(store, profile.id, item.targetId, {
              taskStatus: "queued",
              finished: false,
              startedAgo: { minutes: 0 },
            });
            return { ...item, scanId: scan?.id ?? null };
          }
          return item;
        });
        return { campaignId, items, counts: countOutcomes(items) };
      }),
    ];
  },
});
