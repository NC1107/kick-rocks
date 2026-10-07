import {
  API_ROUTES,
  type CampaignPreview,
  type CampaignSelection,
  countOutcomes,
  isActiveStatus,
  type RenderedEmail,
  type RequestRight,
  type TargetDetail,
  type TargetOutcome,
} from "@kickrocks/shared";
import { defineMockDomain, handle, MockHttpError, notFound } from "./core.js";
import { buildRequest } from "./requests.js";
import { createScan } from "./review.js";
import type { MockStore } from "./store.js";

function targetsFor(store: MockStore, selection: CampaignSelection): TargetDetail[] {
  if ("targetIds" in selection) {
    return selection.targetIds.map((id) => {
      const target = store.targets.find((candidate) => candidate.id === id);
      if (!target) throw notFound(`Target "${id}"`);
      return target;
    });
  }
  switch (selection.preset) {
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

function outcomeFor(store: MockStore, profileId: string, target: TargetDetail): TargetOutcome {
  const base = { targetId: target.id, targetName: target.name, requestId: null, scanId: null };
  const active = store.requests.some(
    (request) =>
      request.profileId === profileId &&
      request.targetId === target.id &&
      isActiveStatus(request.status),
  );
  if (active) return { ...base, outcome: "skipped", reason: "already_active" };
  if (target.needsRecord) {
    const scanning = store.scans.some(
      (scan) =>
        scan.profileId === profileId && scan.targetId === target.id && scan.finishedAt === null,
    );
    return scanning
      ? { ...base, outcome: "skipped", reason: "scan_in_progress" }
      : { ...base, outcome: "scan_started", reason: null };
  }
  if (target.contactMethod === "unknown")
    return { ...base, outcome: "skipped", reason: "no_contact_method" };
  return { ...base, outcome: "request_created", reason: null };
}

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
      ? "Under the California Consumer Privacy Act, I have the right to opt out of the sale or sharing of my personal information and to ask you to delete it."
      : "I am asking you to honor the privacy commitments in your published privacy policy.";
  const asks = rights.map((right) => RIGHT_PHRASES[right]).join(" and ");
  return {
    subject: `Privacy request KR-7H3K2M for ${target.name}`,
    text: [
      `Hello ${target.name} privacy team,`,
      "",
      `I am writing to ask you to ${asks}.`,
      "",
      basis,
      "",
      "This request does not need identity verification for an opt-out. Please confirm in writing when it is done, and keep the reference KR-7H3K2M in your reply.",
      "",
      `${name}`,
      profile?.primaryEmail ?? "",
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
    const needMailbox = (profileId: string, hasEmail: boolean) => {
      if (hasEmail && !profileOf(profileId).mailbox) {
        throw new MockHttpError(
          409,
          "conflict",
          "Connect a mailbox before sending email requests.",
        );
      }
    };

    return [
      handle(API_ROUTES.campaignsPreview, ({ params, body }): CampaignPreview => {
        const profile = profileOf(params.id);
        const targets = targetsFor(store, body.selection);
        const items = targets.map((target) => outcomeFor(store, profile.id, target));
        const first = items.find((item) => item.outcome === "request_created");
        const firstTarget = first
          ? targets.find((target) => target.id === first.targetId)
          : undefined;
        return {
          items,
          counts: countOutcomes(items),
          sampleEmail: firstTarget
            ? sampleEmail(store, profile.id, firstTarget, body.rights)
            : null,
        };
      }),

      handle(API_ROUTES.campaignsCreate, ({ params, body }) => {
        const profile = profileOf(params.id);
        const targets = targetsFor(store, body.selection);
        const planned = targets.map((target) => outcomeFor(store, profile.id, target));
        needMailbox(
          profile.id,
          planned.some((item) => item.outcome === "request_created"),
        );

        const campaignId = store.nextId("cmp");
        const items = planned.map((item): TargetOutcome => {
          if (item.outcome === "request_created") {
            const target = targets.find((candidate) => candidate.id === item.targetId);
            const request = buildRequest(store, {
              profileId: profile.id,
              targetId: item.targetId,
              channel: target?.contactMethod === "form" ? "form" : "email",
              rights: body.rights,
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
