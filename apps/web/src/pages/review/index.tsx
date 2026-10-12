import { API_ROUTES, type ReviewQueue } from "@kickrocks/shared";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { Navigate, useLocation, useSearchParams } from "react-router";
import { errorMessage, useAgents, useApiQuery } from "../../api/index.js";
import { RequireProfile } from "../../components/layout/RequireProfile.js";
import {
  Button,
  Callout,
  LinkTabs,
  PageBack,
  PageHeader,
  Skeleton,
  SkeletonText,
} from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import { describeFailure } from "../../lib/failures.js";
import { paths, type ReviewSection } from "../../lib/paths.js";
import { useWide } from "../../lib/use-wide.js";
import {
  CheckForRepliesButton,
  ReplyCheckResult,
  useReplyCheck,
} from "../mailbox/check-for-replies.js";
import { CleanupPreview } from "../mailbox/intake-review.js";
import { BlockedTaskDetail } from "./BlockedTaskDetail.js";
import { Focus } from "./focus/index.js";
import { shortcutAllowed } from "./keys.js";
import { MailDetail } from "./MailDetail.js";
import { buildEntries, pickEntry, type QueueEntry, SECTION_KINDS, sectionCounts } from "./model.js";
import { QueueList } from "./QueueList.js";
import { legacyDestination } from "./redirects.js";

const DETAIL_ID = "review-detail";

/** Selection and focus travel together, so Enter or Space acts on the row that looks selected. */
function focusEntry(key: string) {
  document.querySelector<HTMLElement>(`[data-entry="${key}"] > :is(a, button)`)?.focus();
}

export function Component() {
  return (
    <RequireProfile>
      {(profile) => <Review profileId={profile.id} mailboxConnected={profile.mailboxConnected} />}
    </RequireProfile>
  );
}

/** A tab shows a count only when there is something to count. */
const some = (count: number | undefined): number | undefined => (count ? count : undefined);

type Page = "needs-you" | ReviewSection;

function pageOf(pathname: string): Page {
  const section = pathname.replace(/\/+$/, "").split("/")[2];
  return section === "mail" || section === "agents" || section === "problems"
    ? section
    : "needs-you";
}

function Loading() {
  return (
    <div aria-busy="true" className="flex max-w-[40rem] flex-col gap-3">
      <span className="sr-only">Loading the review queue</span>
      <Skeleton className="h-10 w-full" />
      <div className="rounded-md border border-line bg-surface p-5">
        <Skeleton className="mb-3 h-6 w-56" />
        <SkeletonText lines={3} />
      </div>
    </div>
  );
}

function Review({ profileId, mailboxConnected }: { profileId: string; mailboxConnected: boolean }) {
  const { pathname, search } = useLocation();
  const page = pageOf(pathname);
  const review = useApiQuery(API_ROUTES.reviewQueue, { query: { profileId } });
  const needsYou = useApiQuery(API_ROUTES.needsYouGet, {
    query: { profileId },
    refetchInterval: 30_000,
  });

  if (pathname.replace(/\/+$/, "") === "/review/scans") {
    return <Navigate to={paths.listings()} replace />;
  }

  const onOldAddress = pathname.replace(/\/+$/, "") === "/review";
  const queues =
    review.data && needsYou.data ? { review: review.data, needsYou: needsYou.data } : undefined;
  const moved = onOldAddress ? legacyDestination(search, queues) : null;
  if (typeof moved === "string" && moved !== "wait") {
    return <Navigate to={moved} replace />;
  }

  const counts = review.data ? sectionCounts(review.data) : null;
  const tabs = [
    {
      to: paths.review(),
      label: "Needs you",
      end: true,
      count: some(needsYou.data?.counts.active),
    },
    { to: paths.reviewSection("mail"), label: "Mail", count: some(counts?.mail) },
    { to: paths.reviewSection("agents"), label: "Agents", count: some(counts?.agents) },
    { to: paths.reviewSection("problems"), label: "Problems", count: some(counts?.problems) },
    { to: paths.listings(), label: "Scans" },
  ];

  const failed = review.isError ? review.error : needsYou.isError ? needsYou.error : null;
  const loading = page === "needs-you" ? needsYou.isPending || review.isPending : review.isPending;

  return (
    <>
      <div className="[&>header]:mb-1">
        <PageHeader title="Review" />
      </div>
      <div className="mb-5">
        <LinkTabs label="Review pages" items={tabs} />
      </div>
      {failed ? (
        <Callout
          intent="danger"
          title="Could not load the review queue"
          action={
            <Button
              size="sm"
              onClick={() => {
                review.refetch();
                needsYou.refetch();
              }}
            >
              Try again
            </Button>
          }
        >
          {errorMessage(failed)}
        </Callout>
      ) : loading || moved === "wait" ? (
        <Loading />
      ) : page === "needs-you" && needsYou.data && review.data ? (
        <Focus
          profileId={profileId}
          mailboxConnected={mailboxConnected}
          queue={needsYou.data}
          review={review.data}
        />
      ) : review.data && page !== "needs-you" ? (
        <ListPage
          key={page}
          page={page}
          queue={review.data}
          profileId={profileId}
          mailboxConnected={mailboxConnected}
        />
      ) : null}
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
    case "agents":
      return (
        <BlockedTaskDetail
          key={entry.key}
          item={entry.item}
          variant="agent"
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
    case "mail":
      return <MailDetail key={entry.key} message={entry.message} profileId={profileId} />;
  }
}

const EMPTY: Record<ReviewSection, string> = {
  mail: "No unsorted mail.",
  agents: "No agent tasks.",
  problems: "No problems.",
};

/** Mail, Agents and Problems: a list on the left and the open row on the right. */
function ListPage({
  page,
  queue,
  profileId,
  mailboxConnected,
}: {
  page: ReviewSection;
  queue: ReviewQueue;
  profileId: string;
  mailboxConnected: boolean;
}) {
  const [params, setParams] = useSearchParams();
  const check = useReplyCheck(profileId);
  const all = useMemo(() => buildEntries(queue), [queue]);
  const kinds = SECTION_KINDS[page];
  const entries = useMemo(() => all.filter((entry) => kinds.includes(entry.kind)), [all, kinds]);
  const agents = useAgents({ enabled: page === "agents" && entries.length > 0 });
  const itemParam = params.get("item");
  const lastIndex = useRef(0);
  const pane = useRef<HTMLDivElement>(null);
  const wide = useWide();

  const selected = pickEntry(entries, { item: itemParam, lastIndex: lastIndex.current });
  const selectedKey = selected?.key ?? null;

  useEffect(() => {
    if (selected) lastIndex.current = entries.indexOf(selected);
  }, [entries, selected]);

  // After a decision removes the open item, the URL names the item that took its place.
  useEffect(() => {
    if (itemParam !== null && itemParam !== selectedKey) {
      setParams(selectedKey ? new URLSearchParams({ item: selectedKey }) : new URLSearchParams(), {
        replace: true,
      });
    }
  }, [itemParam, selectedKey, setParams]);

  const select = (key: string, { replace }: { replace: boolean }) =>
    setParams(new URLSearchParams({ item: key }), { replace });

  const move = (step: 1 | -1) => {
    const keys = entries.map((entry) => entry.key);
    const next =
      keys[Math.min(Math.max(keys.indexOf(selectedKey ?? "") + step, 0), keys.length - 1)];
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
    if (selectedKey) {
      document
        .querySelector(`[data-entry="${selectedKey}"]`)
        ?.scrollIntoView?.({ block: "nearest" });
    }
  }, [selectedKey]);

  // Deciding an item removes the control that had focus, and the list advances behind it. The new
  // row takes focus, once any confirm dialog has closed, so a keyboard user carries on from there.
  const owedFocus = useRef(false);
  const selectedRef = useRef(selectedKey);
  selectedRef.current = selectedKey;
  const previousKey = useRef(selectedKey);
  const drilled = itemParam !== null;
  const listShownRef = useRef(true);
  listShownRef.current = wide || !drilled;

  const settleFocus = useCallback(() => {
    if (!owedFocus.current || document.querySelector("dialog[open]")) return;
    owedFocus.current = false;
    const active = document.activeElement;
    if (active && active !== document.body) return;
    // Below the split layout the list is hidden while an item is open, so the pane takes focus.
    if (listShownRef.current && selectedRef.current) focusEntry(selectedRef.current);
    else pane.current?.focus();
  }, []);

  useEffect(() => {
    const removed =
      previousKey.current !== null && !entries.some((entry) => entry.key === previousKey.current);
    previousKey.current = selectedKey;
    if (removed) owedFocus.current = true;
    settleFocus();
  }, [entries, selectedKey, settleFocus]);

  useEffect(() => {
    const onClose = () => setTimeout(settleFocus, 0);
    document.addEventListener("close", onClose, true);
    return () => document.removeEventListener("close", onClose, true);
  }, [settleFocus]);

  // Below the split layout, opening or closing an item swaps which half is on screen. The half
  // that was focused is now hidden, so focus follows the swap instead of falling to the body.
  const wasDrilled = useRef(drilled);
  useEffect(() => {
    if (wasDrilled.current === drilled) return;
    wasDrilled.current = drilled;
    if (wide) return;
    if (drilled) pane.current?.focus();
    else if (selectedRef.current) focusEntry(selectedRef.current);
  }, [drilled, wide]);

  const mailHeader =
    page === "mail" ? (
      <div className="flex flex-col gap-3">
        {mailboxConnected ? <CheckForRepliesButton check={check} /> : null}
        <ReplyCheckResult check={check} />
        <CleanupPreview profileId={profileId} compact />
      </div>
    ) : undefined;

  return (
    <div className="grid grid-cols-1 gap-5 lg:h-[calc(100dvh-14rem)] lg:min-h-[30rem] lg:grid-cols-[22.5rem_minmax(0,1fr)]">
      <div className={cn("min-h-0 lg:overflow-y-auto lg:pr-1 lg:pb-2", drilled && "max-lg:hidden")}>
        <QueueList
          entries={entries}
          kinds={kinds}
          empty={EMPTY[page]}
          {...(page === "agents"
            ? { waiting: queue.waitingTasks, waitingTotal: queue.waitingTotal }
            : {})}
          selectedKey={wide || drilled ? selectedKey : null}
          onSelect={(key) => select(key, { replace: wide })}
          agents={agents.data}
          header={mailHeader}
        />
      </div>
      <div
        id={DETAIL_ID}
        ref={pane}
        tabIndex={-1}
        className={cn(
          "flex min-h-0 min-w-0 flex-col rounded-md border border-line bg-surface outline-none lg:overflow-hidden",
          !drilled && "max-lg:hidden",
          !selected && "max-lg:hidden lg:hidden",
        )}
      >
        <div className="border-b border-line px-3 pt-3 pb-2 lg:hidden">
          <PageBack fallback={{ to: paths.reviewSection(page), label: "Review" }} />
        </div>
        {selected ? <Detail entry={selected} entries={entries} profileId={profileId} /> : null}
      </div>
    </div>
  );
}
