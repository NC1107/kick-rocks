import { API_ROUTES, type ReviewQueue } from "@kickrocks/shared";
import { ChevronLeft } from "lucide-react";
import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { useSearchParams } from "react-router";
import { errorMessage, useApiQuery } from "../../api/index.js";
import { RequireProfile } from "../../components/layout/RequireProfile.js";
import { Alert, Button, PageHeader, Skeleton, SkeletonText } from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import { describeFailure } from "../../lib/failures.js";
import { BlockedTaskDetail } from "./BlockedTaskDetail.js";
import { shortcutAllowed } from "./keys.js";
import { MailDetail } from "./MailDetail.js";
import { MatchDetail } from "./MatchDetail.js";
import { buildEntries, pickEntry, type QueueEntry, SCANS_KEY } from "./model.js";
import { QueueList } from "./QueueList.js";
import { ScansPanel } from "./ScansPanel.js";
import { VerificationDetail } from "./VerificationDetail.js";

const DETAIL_ID = "review-detail";
const WIDE = "(min-width: 1024px)";

/** Whether the list and the item sit side by side, which is also when one is always selected. */
function useWide(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}

/** Selection and focus travel together, so Enter or Space acts on the row that looks selected. */
function focusEntry(key: string) {
  document.querySelector<HTMLElement>(`[data-entry="${key}"] > :is(a, button)`)?.focus();
}

export function Component() {
  return <RequireProfile>{(profile) => <Review profileId={profile.id} />}</RequireProfile>;
}

function Loading() {
  return (
    <div aria-busy="true" className="grid grid-cols-1 gap-5 lg:grid-cols-[22.5rem_minmax(0,1fr)]">
      <span className="sr-only">Loading the review queue</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-13 w-full" />
        <Skeleton className="h-13 w-full" />
        <Skeleton className="h-13 w-full" />
      </div>
      <div className="hidden rounded-md border border-line bg-surface p-5 lg:block">
        <Skeleton className="mb-3 h-6 w-56" />
        <SkeletonText lines={5} />
      </div>
    </div>
  );
}

function Review({ profileId }: { profileId: string }) {
  const [params] = useSearchParams();
  const queue = useApiQuery(API_ROUTES.reviewQueue, { query: { profileId } });
  const drilled = params.has("item");

  return (
    <>
      <div className={cn(drilled && "max-lg:hidden")}>
        <PageHeader title="Review" description="Everything waiting on you" />
      </div>
      {queue.isPending ? (
        <Loading />
      ) : queue.isError ? (
        <Alert
          intent="danger"
          title="Could not load the review queue"
          action={
            <Button size="sm" onClick={() => queue.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(queue.error)}
        </Alert>
      ) : (
        <Queue queue={queue.data} profileId={profileId} />
      )}
    </>
  );
}

function Detail({
  entry,
  entries,
  profileId,
}: {
  entry: QueueEntry;
  entries: readonly QueueEntry[];
  profileId: string;
}) {
  switch (entry.kind) {
    case "blocked":
    case "agents":
      return (
        <BlockedTaskDetail
          key={entry.key}
          item={entry.item}
          variant={entry.kind === "agents" ? "agent" : "blocked"}
          profileId={profileId}
        />
      );
    case "failed": {
      const { group } = describeFailure(entry.item.task);
      const siblings = entries.flatMap((other) =>
        other.kind === "failed" && describeFailure(other.item.task).group === group
          ? [other.item]
          : [],
      );
      return (
        <BlockedTaskDetail
          key={entry.key}
          item={entry.item}
          variant="failed"
          profileId={profileId}
          siblings={siblings}
        />
      );
    }
    case "matches":
      return <MatchDetail key={entry.key} match={entry.match} />;
    case "verifications":
      return <VerificationDetail key={entry.key} item={entry.item} />;
    case "mail":
      return <MailDetail key={entry.key} message={entry.message} profileId={profileId} />;
  }
}

function Queue({ queue, profileId }: { queue: ReviewQueue; profileId: string }) {
  const [params, setParams] = useSearchParams();
  const entries = useMemo(() => buildEntries(queue), [queue]);
  const itemParam = params.get("item");
  const tabParam = params.get("tab");
  const lastIndex = useRef(0);
  const pane = useRef<HTMLDivElement>(null);
  const wide = useWide();

  const wantsScans = itemParam === SCANS_KEY || (itemParam === null && tabParam === "scans");
  const selected = wantsScans
    ? null
    : pickEntry(entries, { item: itemParam, tab: tabParam, lastIndex: lastIndex.current });
  const showScans = selected === null;
  const selectedKey = showScans ? SCANS_KEY : selected.key;

  useEffect(() => {
    if (selected) lastIndex.current = entries.indexOf(selected);
  }, [entries, selected]);

  const select = (key: string, { replace }: { replace: boolean }) =>
    setParams(new URLSearchParams({ item: key }), { replace });

  const move = (step: 1 | -1) => {
    const keys = [...entries.map((entry) => entry.key), SCANS_KEY];
    const next = keys[Math.min(Math.max(keys.indexOf(selectedKey) + step, 0), keys.length - 1)];
    if (!next || next === selectedKey) return;
    select(next, { replace: true });
    if (!pane.current?.contains(document.activeElement)) focusEntry(next);
  };

  // The handler reads the latest selection, so it is re-bound whenever that changes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!shortcutAllowed(event)) return;
      const inList = event.target instanceof Element && event.target.closest("[data-entry]");
      if (event.key === "j" || (inList && event.key === "ArrowDown")) move(1);
      else if (event.key === "k" || (inList && event.key === "ArrowUp")) move(-1);
      else if (event.key === "Enter" && event.target === document.body) pane.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    document.querySelector(`[data-entry="${selectedKey}"]`)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedKey]);

  const drilled = itemParam !== null;
  return (
    <div className="grid grid-cols-1 gap-5 lg:h-[calc(100dvh-9.5rem)] lg:min-h-[30rem] lg:grid-cols-[22.5rem_minmax(0,1fr)]">
      <div className={cn("min-h-0 lg:overflow-y-auto lg:pr-1 lg:pb-2", drilled && "max-lg:hidden")}>
        <QueueList
          entries={entries}
          selectedKey={wide || drilled ? selectedKey : null}
          onSelect={(key) => select(key, { replace: wide })}
        />
      </div>
      <div
        id={DETAIL_ID}
        ref={pane}
        tabIndex={-1}
        className={cn(
          "flex min-h-0 min-w-0 flex-col rounded-md border border-line bg-surface outline-none lg:overflow-hidden",
          !drilled && "max-lg:hidden",
        )}
      >
        <div className="border-b border-line px-2 py-1.5 lg:hidden">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setParams(new URLSearchParams(), { replace: true })}
          >
            <ChevronLeft aria-hidden="true" strokeWidth={1.5} />
            Review
          </Button>
        </div>
        {selected ? (
          <Detail entry={selected} entries={entries} profileId={profileId} />
        ) : (
          <ScansPanel profileId={profileId} />
        )}
      </div>
    </div>
  );
}
