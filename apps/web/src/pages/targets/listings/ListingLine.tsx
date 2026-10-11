import type { ListingSite, RequestStatus } from "@kickrocks/shared";
import type { ReactNode } from "react";
import { HoldReason } from "../../../components/holds/HoldReason.js";
import { MetaMark, RelativeTime, TextLink } from "../../../components/ui/index.js";
import { describeFailure } from "../../../lib/failures.js";
import { formatShortDate, pluralize } from "../../../lib/format.js";
import { LISTING_STATUS_META, pendingRecords } from "../../../lib/listings.js";
import { paths } from "../../../lib/paths.js";
import { REQUEST_STATUS_META } from "../../../lib/status.js";

const REMOVAL_WORDS: Partial<Record<RequestStatus, string>> = {
  draft: "Removal queued",
  queued: "Removal queued",
  sent: "Removal sent, awaiting reply",
  awaiting_reply: "Removal sent, awaiting reply",
  follow_up_due: "No reply yet, follow-up due",
  no_response: "No reply to the removal",
  needs_verification: "The site wants something from you",
  rejected: "Removal refused",
  bounced: "Removal bounced",
};

function removalWords(site: ListingSite): string {
  const request = site.records.find((record) => record.decision === "mine")?.request;
  if (!request) return "Removal started";
  return (
    REMOVAL_WORDS[request.status] ??
    `Removal: ${REQUEST_STATUS_META[request.status].label.toLowerCase()}`
  );
}

function removedOn(site: ListingSite): string {
  const dates = site.records.flatMap((record) =>
    record.request && ["confirmed", "no_record"].includes(record.request.status)
      ? [record.request.updatedAt]
      : [],
  );
  const latest = dates.sort().at(-1);
  return latest ? `Removed, confirmed ${formatShortDate(latest)}` : "Removed";
}

function notScannedWords(site: ListingSite): string {
  switch (site.readiness.state) {
    case "needs_details":
      return `Can't scan: add ${site.readiness.missing ?? "more details"}`;
    case "no_recipe":
      return "Needs an agent";
    case "recipe_review":
      return "Recipe waits for your review";
    case "ready":
      return "Not scanned yet";
  }
}

/** One plain sentence for where a site stands, with the reason behind a wait or a failure. */
function sentence(site: ListingSite, profileId: string): ReactNode {
  const scan = site.latestScan;
  switch (site.status) {
    case "to_confirm":
      return `${pluralize(pendingRecords(site).length, "record")} to confirm`;
    case "yours":
      return removalWords(site);
    case "relisted":
      return "Listed again, removal reopened";
    case "removed":
      return removedOn(site);
    case "not_you":
      return "Nothing found is you";
    case "not_found":
      return "Not found";
    case "unclear":
      return "The page showed nothing; it may have blocked the search. Will retry at next rescan";
    case "failed":
      return scan?.error
        ? describeFailure({ lastError: scan.error, failureKind: null }).detail
        : "The scan failed";
    case "scanning":
      return "Scanning now";
    case "waiting":
      if (scan?.hold) {
        return (
          <HoldReason
            hold={scan.hold}
            profileId={profileId}
            targetId={site.targetId}
            compact
            glyph={false}
            showSite={false}
          />
        );
      }
      return scan?.taskStatus === "blocked" ? (
        <>
          Waiting on a check in <TextLink to={paths.review()}>Review</TextLink>
        </>
      ) : (
        "Queued"
      );
    case "paused":
      return site.preference.pausedUntil
        ? `Paused until ${formatShortDate(site.preference.pausedUntil)}`
        : "Paused until you resume";
    case "skipped":
      return "Skipped";
    case "not_scanned":
      return notScannedWords(site);
  }
}

/** The status mark and its sentence, as one line that can wrap. */
export function ListingLine({ site, profileId }: { site: ListingSite; profileId: string }) {
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <MetaMark meta={LISTING_STATUS_META[site.status]} />
      <span className="min-w-0 break-words text-meta text-ink-2">{sentence(site, profileId)}</span>
    </span>
  );
}

/** "Scanned 2d ago, next Nov 3", or nothing when the site has never been scanned. */
export function ScanTimes({ site }: { site: ListingSite }) {
  if (!site.latestScan) return null;
  return (
    <span className="font-mono text-caption text-ink-3">
      Scanned <RelativeTime iso={site.latestScan.startedAt} />
      {site.nextRescanAt ? `, next ${formatShortDate(site.nextRescanAt)}` : ""}
    </span>
  );
}
