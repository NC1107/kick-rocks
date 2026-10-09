import { API_ROUTES, type MailboxPollOutcome } from "@kickrocks/shared";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { routeKeyPrefix } from "../../api/hooks.js";
import {
  type ApiRequestError,
  errorMessage,
  useApiMutation,
  useApiQuery,
} from "../../api/index.js";
import { Button, Callout, LinkButton } from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";

export const POLL_FOLLOW_MS = 1_000;
/** A check that has not ended by now is left to finish in the background. */
export const POLL_GIVE_UP_MS = 90_000;
/** Once a check is called slow, the page asks about it less often, since it may take a long while. */
export const POLL_SLOW_FOLLOW_MS = 10_000;
const DEFAULT_WAIT_SECONDS = 30;

/** What a finished check can change, so the pages that show it read again. */
const REFRESHED_AFTER_CHECK = [
  API_ROUTES.requestsGet,
  API_ROUTES.requestsList,
  API_ROUTES.dashboardGet,
  API_ROUTES.reviewQueue,
  API_ROUTES.profilesGet,
] as const;

export type ReplyCheckPhase =
  | { kind: "idle" }
  | { kind: "checking" }
  | { kind: "slow" }
  | { kind: "error"; message: string }
  | { kind: "finished"; outcome: MailboxPollOutcome };

export interface ReplyCheck {
  profileId: string;
  phase: ReplyCheckPhase;
  /** Whole seconds until the server takes another check, or 0 when it does. */
  waitSeconds: number;
  start: () => void;
}

/** What a 429 asks for: the wait the server sent, or the usual gap if the body did not say. */
function waitOf(error: ApiRequestError): number {
  const body = error.body as { retryAfterSeconds?: unknown } | undefined;
  const seconds = body?.retryAfterSeconds;
  return typeof seconds === "number" && seconds > 0 ? seconds : DEFAULT_WAIT_SECONDS;
}

/** Counts a wait down to zero, so a notice about it never outlives it. */
function useCountdown(until: number | null, clear: () => void): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (until === null) return;
    setNow(Date.now());
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current >= until) clear();
    }, 1_000);
    return () => clearInterval(timer);
  }, [until, clear]);
  return until === null ? 0 : Math.max(0, Math.ceil((until - now) / 1000));
}

/**
 * Asks the server to read a profile's mailbox now and follows that one check until it ends. A tap
 * while a check runs joins it on the server, so the page never queues a second one.
 */
export function useReplyCheck(profileId: string): ReplyCheck {
  const queryClient = useQueryClient();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [startFailure, setStartFailure] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [slow, setSlow] = useState(false);
  const refreshedFor = useRef<string | null>(null);
  const waitSeconds = useCountdown(
    waitUntil,
    useCallback(() => setWaitUntil(null), []),
  );

  const begin = useApiMutation(API_ROUTES.mailboxPoll, {
    onSuccess: (poll) => {
      setStartFailure(null);
      setWaitUntil(null);
      setSlow(false);
      setTaskId(poll.task.id);
    },
    onError: (error) => {
      if (error.status === 429) {
        setStartFailure(null);
        setWaitUntil(Date.now() + waitOf(error) * 1000);
      } else {
        setStartFailure(errorMessage(error));
      }
    },
  });

  const follow = useApiQuery(
    API_ROUTES.mailboxPollGet,
    taskId
      ? {
          params: { id: profileId, taskId },
          refetchInterval: (poll) =>
            poll?.outcome ? false : slow ? POLL_SLOW_FOLLOW_MS : POLL_FOLLOW_MS,
        }
      : skipToken,
  );

  const outcome = follow.data?.outcome ?? null;
  const settled = outcome !== null || follow.isError;

  useEffect(() => {
    if (!taskId || settled) return;
    const timer = setTimeout(() => setSlow(true), POLL_GIVE_UP_MS);
    return () => clearTimeout(timer);
  }, [taskId, settled]);

  useEffect(() => {
    if (!taskId || !outcome || refreshedFor.current === taskId) return;
    refreshedFor.current = taskId;
    for (const route of REFRESHED_AFTER_CHECK) {
      void queryClient.invalidateQueries({ queryKey: routeKeyPrefix(route) });
    }
  }, [taskId, outcome, queryClient]);

  let phase: ReplyCheckPhase = { kind: "idle" };
  if (begin.isPending) phase = { kind: "checking" };
  else if (startFailure) phase = { kind: "error", message: startFailure };
  else if (taskId) {
    if (outcome) phase = { kind: "finished", outcome };
    else if (follow.isError) phase = { kind: "error", message: errorMessage(follow.error) };
    else phase = slow ? { kind: "slow" } : { kind: "checking" };
  }

  return {
    profileId,
    phase,
    waitSeconds,
    start: () => begin.mutate({ params: { id: profileId } }),
  };
}

/** True when the last check ended because the mailbox could not be read. */
export function checkFailedOnMailbox({ phase }: ReplyCheck): boolean {
  return phase.kind === "finished" && phase.outcome.state === "failed";
}

export function CheckForRepliesButton({
  check,
  variant = "secondary",
}: {
  check: ReplyCheck;
  variant?: "secondary" | "primary";
}) {
  const checking = check.phase.kind === "checking";
  return (
    <Button
      variant={variant}
      loading={checking}
      disabled={check.waitSeconds > 0}
      onClick={check.start}
    >
      {checking ? null : <MailCheck aria-hidden="true" />}
      Check for replies
    </Button>
  );
}

const plural = (count: number, one: string, many: string) =>
  count === 1 ? `1 ${one}` : `${count} ${many}`;

const secondsText = (seconds: number) => plural(seconds, "second", "seconds");

function titleOf(outcome: Extract<MailboxPollOutcome, { state: "done" }>): string {
  if (outcome.matched > 0) return plural(outcome.matched, "new reply", "new replies");
  if (outcome.needsReview > 0) {
    return plural(
      Math.max(outcome.newMessages, outcome.needsReview),
      "new message",
      "new messages",
    );
  }
  return outcome.newMessages === 0 ? "No new mail" : "No new replies";
}

/**
 * Where the matched replies went, worded for how many there are and whose timeline they are on.
 * `here` is the request the page is about.
 */
function timelineOf(matched: number, ids: readonly string[], here: string | undefined): string {
  if (ids.length > 1) return "They are on the requests' timelines.";
  const pronoun = matched === 1 ? "It is" : "They are";
  return ids[0] === here
    ? `${pronoun} on the request's timeline.`
    : `${pronoun} on that request's timeline.`;
}

/**
 * What the last check found, in a notice that stays until the next one starts. `here` is the
 * request the page is about, so a reply to it needs no link back to the page already open, and
 * `onMailboxPage` is set where the page itself is the place to fix the mailbox.
 */
export function ReplyCheckResult({
  check,
  here,
  onMailboxPage = false,
  className,
}: {
  check: ReplyCheck;
  here?: string;
  onMailboxPage?: boolean;
  className?: string | undefined;
}) {
  const { phase } = check;
  const wait =
    check.waitSeconds > 0 ? (
      <p className={cn("text-meta text-ink-3", className)}>
        Try again in {secondsText(check.waitSeconds)}.
      </p>
    ) : null;

  if (phase.kind === "idle") return wait;

  if (phase.kind === "checking") {
    return (
      <p role="status" className="sr-only">
        Checking for replies
      </p>
    );
  }

  if (phase.kind === "slow") {
    return (
      <Callout intent="info" title="Still checking" className={className}>
        The mail server is slow to answer. Kick Rocks keeps going, and new replies show up here when
        they are read.
      </Callout>
    );
  }

  if (phase.kind === "error") {
    return (
      <Callout
        intent="danger"
        title="Could not check for replies"
        className={className}
        action={
          <Button size="sm" onClick={check.start}>
            Try again
          </Button>
        }
      >
        {phase.message}
      </Callout>
    );
  }

  const { outcome } = phase;
  if (outcome.state === "failed") {
    return (
      <Callout
        intent="danger"
        title="Could not check the mailbox"
        className={className}
        action={
          onMailboxPage ? undefined : (
            <LinkButton size="sm" to={`/profiles/${check.profileId}/mailbox`}>
              Fix the mailbox
            </LinkButton>
          )
        }
      >
        {outcome.error}
      </Callout>
    );
  }

  return (
    <>
      <FoundNotice outcome={outcome} here={here} className={className} />
      {wait}
    </>
  );
}

function FoundNotice({
  outcome,
  here,
  className,
}: {
  outcome: Extract<MailboxPollOutcome, { state: "done" }>;
  here: string | undefined;
  className: string | undefined;
}) {
  const ids = [...new Set(outcome.matchedRequestIds)];
  const others = ids.filter((id) => id !== here);
  const elsewhere = ids.length > 0 && others.length === ids.length ? others : [];
  const only = elsewhere.length === 1 ? (elsewhere[0] ?? null) : null;
  const named = useApiQuery(API_ROUTES.requestsGet, only ? { params: { id: only } } : skipToken);
  const targetName = named.data?.target.name;

  const link =
    outcome.matched === 0
      ? null
      : others.length === 1
        ? { to: `/requests/${others[0]}`, label: "Open the request" }
        : others.length > 1
          ? { to: "/requests", label: "See requests" }
          : null;
  const title = titleOf(outcome);

  return (
    <Callout
      intent={outcome.matched > 0 ? "success" : "info"}
      title={outcome.matched > 0 && targetName ? `${title}, for ${targetName}` : title}
      className={className}
      action={
        link ? (
          <LinkButton size="sm" to={link.to}>
            {link.label}
          </LinkButton>
        ) : outcome.needsReview > 0 ? (
          <LinkButton size="sm" to="/review">
            Open Review
          </LinkButton>
        ) : undefined
      }
    >
      {outcome.needsReview > 0
        ? `${plural(outcome.needsReview, "message needs", "messages need")} a look from you.`
        : outcome.matched > 0
          ? timelineOf(outcome.matched, ids, here)
          : null}
    </Callout>
  );
}
