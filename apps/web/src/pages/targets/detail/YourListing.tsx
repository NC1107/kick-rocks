import { API_ROUTES, type ListingDetail, RESCAN_CHOICES } from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useLocation } from "react-router";
import { errorMessage, useApiQuery, useCurrentProfile } from "../../../api/index.js";
import { HoldReason } from "../../../components/holds/HoldReason.js";
import {
  Button,
  Callout,
  Checkbox,
  Disclosure,
  Input,
  RelativeTime,
  RowGroup,
  Section,
  Select,
  Skeleton,
  TaskStatusMark,
} from "../../../components/ui/index.js";
import { describeFailure } from "../../../lib/failures.js";
import { formatShortDate } from "../../../lib/format.js";
import { pendingRecords } from "../../../lib/listings.js";
import { ActionRow, BodyRow, FieldRow, GroupNote } from "../../settings/rows.js";
import { ListingLine, ScanTimes } from "../listings/ListingLine.js";
import { RecordList } from "../listings/Records.js";
import { pauseEnd } from "../listings/SiteMenu.js";
import { ScanDialog, usePastAddressCount, useSitePreference } from "../listings/scanning.js";

const GLOBAL = "global";
const MANUAL = "manual";

function cadenceValue(listing: ListingDetail): string {
  if (!listing.preference.autoRescan) return MANUAL;
  return listing.preference.rescanDays === null ? GLOBAL : String(listing.preference.rescanDays);
}

function historyResult(
  entry: ListingDetail["history"][number],
  profileId: string,
  targetId: string,
) {
  if (entry.error) return describeFailure({ lastError: entry.error, failureKind: null }).detail;
  if (entry.hold) {
    return (
      <HoldReason
        hold={entry.hold}
        profileId={profileId}
        targetId={targetId}
        compact
        glyph={false}
        showSite={false}
      />
    );
  }
  if (entry.finishedAt === null) return "Waiting for results";
  return entry.candidateCount === 0
    ? "No records found"
    : `${entry.candidateCount} ${entry.candidateCount === 1 ? "record" : "records"}`;
}

function History({ listing, profileId }: { listing: ListingDetail; profileId: string }) {
  const [open, setOpen] = useState(false);
  if (listing.history.length === 0) return null;
  return (
    <Disclosure
      title="Scan history"
      description={`Last ${listing.history.length} ${listing.history.length === 1 ? "run" : "runs"}`}
      open={open}
      onOpenChange={setOpen}
    >
      <RowGroup>
        {listing.history.map((entry) => (
          <div key={entry.id} className="flex flex-col gap-1 px-3.5 py-2.5">
            <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-meta">
              {entry.taskStatus ? <TaskStatusMark status={entry.taskStatus} /> : null}
              <span className="font-mono text-caption text-ink-3">
                <RelativeTime iso={entry.startedAt} />
              </span>
            </span>
            <span className="text-meta text-ink-2">
              {historyResult(entry, profileId, listing.targetId)}
            </span>
          </div>
        ))}
      </RowGroup>
    </Disclosure>
  );
}

function Controls({ listing, profileId }: { listing: ListingDetail; profileId: string }) {
  const preference = useSitePreference(profileId, listing.targetId);
  const past = usePastAddressCount(profileId);
  const settings = useApiQuery(API_ROUTES.settingsGet);
  const globalDays = settings.data?.schedule.peopleSearchRescanDays ?? 60;
  const [scanning, setScanning] = useState(false);
  const [until, setUntil] = useState(pauseEnd());
  const { mode } = listing.preference;
  const scanned = listing.latestScan !== null;

  return (
    <>
      <RowGroup>
        <ActionRow
          title={mode === "skipped" ? "Unskip and scan" : scanned ? "Rescan" : "Scan now"}
          description="Searches this site for you. It waits its turn if the site was visited recently."
        >
          <Button
            variant="primary"
            disabled={preference.pending}
            onClick={() =>
              mode === "skipped"
                ? preference.set({ mode: "auto" }, () => setScanning(true))
                : setScanning(true)
            }
          >
            {mode === "skipped" ? "Unskip and scan" : scanned ? "Rescan" : "Scan now"}
          </Button>
        </ActionRow>
        <FieldRow
          label="Automatic rescans"
          help={
            listing.preference.rescanDays === null && listing.preference.autoRescan
              ? "Follows the schedule in Settings."
              : undefined
          }
        >
          <Select
            value={cadenceValue(listing)}
            disabled={preference.pending}
            onChange={(event) => {
              const value = event.target.value;
              preference.set({
                mode,
                ...(mode === "paused" ? { pausedUntil: listing.preference.pausedUntil } : {}),
                autoRescan: value !== MANUAL,
                rescanDays:
                  value === GLOBAL || value === MANUAL
                    ? null
                    : (Number(value) as (typeof RESCAN_CHOICES)[number]),
              });
            }}
          >
            <option value={GLOBAL}>Every {globalDays} days (Settings)</option>
            {RESCAN_CHOICES.map((days) => (
              <option key={days} value={days}>
                Every {days} days
              </option>
            ))}
            <option value={MANUAL}>Only when I ask</option>
          </Select>
        </FieldRow>
        {mode === "paused" ? (
          <ActionRow
            title="Paused"
            description={
              listing.preference.pausedUntil
                ? `Until ${formatShortDate(listing.preference.pausedUntil)}`
                : "Until you resume"
            }
          >
            <Button disabled={preference.pending} onClick={() => preference.set({ mode: "auto" })}>
              Resume
            </Button>
          </ActionRow>
        ) : (
          <BodyRow className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1 basis-48">
              <p className="text-ui font-medium text-ink">Pause until</p>
              <p className="text-meta text-ink-3">Scans and rescans skip this site until then.</p>
            </div>
            <span className="flex items-center gap-2">
              <Input
                type="date"
                aria-label="Pause until"
                min={pauseEnd(1)}
                value={until}
                onChange={(event) => setUntil(event.target.value)}
                className="w-40"
              />
              <Button
                disabled={preference.pending || until === "" || mode === "skipped"}
                onClick={() => preference.set({ mode: "paused", pausedUntil: until })}
              >
                Pause
              </Button>
            </span>
          </BodyRow>
        )}
        <ActionRow
          title={mode === "skipped" ? "Skipped" : "Skip this site"}
          description={
            mode === "skipped"
              ? "Left out of every scan and rescan."
              : "Leaves it out of every scan and rescan until you change your mind."
          }
        >
          <Button
            disabled={preference.pending}
            onClick={() => preference.set({ mode: mode === "skipped" ? "auto" : "skipped" })}
          >
            {mode === "skipped" ? "Unskip" : "Skip"}
          </Button>
        </ActionRow>
        <BodyRow>
          <Checkbox
            label="Include past addresses"
            description={
              past === 0
                ? "This profile has no past addresses."
                : past === 1
                  ? "Your past address is a separate search."
                  : `Each of the ${past} past addresses is a separate search.`
            }
            checked={listing.preference.includePastAddresses}
            disabled={preference.pending || past === 0}
            onChange={(event) =>
              preference.set({
                mode,
                ...(mode === "paused" ? { pausedUntil: listing.preference.pausedUntil } : {}),
                includePastAddresses: event.target.checked,
              })
            }
          />
        </BodyRow>
      </RowGroup>
      {preference.error ? (
        <p role="alert" className="mt-2 text-caption text-danger-text">
          {preference.error}
        </p>
      ) : null}
      <GroupNote>Settings has the pace limits that apply to every site.</GroupNote>
      {scanning ? (
        <ScanDialog
          open
          onClose={() => setScanning(false)}
          profileId={profileId}
          selection={{ targetIds: [listing.targetId] }}
          title={`Scan ${listing.targetName}?`}
          description="Kick Rocks searches this site for this person. Nothing is removed until you confirm a record."
          siteCount={1}
          sitePreference={listing.preference.includePastAddresses}
        />
      ) : null}
    </>
  );
}

/** What is known about the current profile on this site, and the controls for scanning it. */
export function YourListing({ targetId }: { targetId: string }) {
  const { profile } = useCurrentProfile();
  const query = useApiQuery(
    API_ROUTES.listingsGet,
    profile ? { params: { id: profile.id, targetId } } : skipToken,
  );
  const { hash } = useLocation();
  const loaded = query.isSuccess;
  useEffect(() => {
    if (hash === "#your-listing" && loaded) {
      document.getElementById("your-listing")?.scrollIntoView?.({ block: "start" });
    }
  }, [hash, loaded]);
  if (!profile) return null;

  return (
    <Section label="Your listing">
      <div id="your-listing" className="flex scroll-mt-20 flex-col gap-3">
        {query.isPending ? (
          <Skeleton className="h-24 w-full rounded-md" />
        ) : query.isError ? (
          <Callout intent="danger" title="Could not load your listing">
            {errorMessage(query.error)}
          </Callout>
        ) : (
          <>
            <RowGroup>
              <div className="flex flex-col gap-1 px-3.5 py-3">
                <ListingLine site={query.data} profileId={profile.id} />
                <ScanTimes site={query.data} />
              </div>
            </RowGroup>
            <RecordList
              records={[
                ...pendingRecords(query.data),
                ...query.data.records.filter((record) => record.decision !== "pending"),
              ]}
              label={`Records on ${query.data.targetName}`}
            />
            <Controls listing={query.data} profileId={profile.id} />
            <History listing={query.data} profileId={profile.id} />
          </>
        )}
      </div>
    </Section>
  );
}
