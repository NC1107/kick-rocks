import { API_ROUTES, type MailboxPollOutcome } from "@kickrocks/shared";
import { skipToken, useQueryClient } from "@tanstack/react-query";
import { MailCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { routeKeyPrefix } from "../../api/hooks.js";
import { errorMessage, useApiMutation, useApiQuery } from "../../api/index.js";
import { Button, Callout, LinkButton } from "../../components/ui/index.js";

export const POLL_FOLLOW_MS = 1_000;
/** A check that has not ended by now is left to finish in the background. */
export const POLL_GIVE_UP_MS = 90_000;

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
  | { kind: "too_soon"; message: string }
  | { kind: "error"; message: string }
  | { kind: "finished"; outcome: MailboxPollOutcome };

export interface ReplyCheck {
  profileId: string;
  phase: ReplyCheckPhase;
  start: () => void;
}

/**
 * Asks the server to read a profile's mailbox now and follows that one check until it ends. A tap
 * while a check runs joins it on the server, so the page never queues a second one.
 */
export function useReplyCheck(profileId: string): ReplyCheck {
  const queryClient = useQueryClient();
  const [taskId, setTaskId] = useState<string | null>(null);
  const [startFailure, setStartFailure] = useState<ReplyCheckPhase | null>(null);
  const [slow, setSlow] = useState(false);
  const refreshedFor = useRef<string | null>(null);

  const begin = useApiMutation(API_ROUTES.mailboxPoll, {
    onSuccess: (poll) => {
      setStartFailure(null);
      setSlow(false);
      setTaskId(poll.task.id);
    },
    onError: (error) =>
      setStartFailure(
        error.status === 429
          ? { kind: "too_soon", message: error.message }
          : { kind: "error", message: errorMessage(error) },
      ),
  });

  const follow = useApiQuery(
    API_ROUTES.mailboxPollGet,
    taskId
      ? {
          params: { id: profileId, taskId },
          refetchInterval: (poll) => (poll?.outcome ? false : POLL_FOLLOW_MS),
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
  else if (startFailure) phase = startFailure;
  else if (taskId) {
    if (outcome) phase = { kind: "finished", outcome };
    else if (follow.isError) phase = { kind: "error", message: errorMessage(follow.error) };
    else phase = slow ? { kind: "slow" } : { kind: "checking" };
  }

  return {
    profileId,
    phase,
    start: () => begin.mutate({ params: { id: profileId } }),
  };
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
    <Button variant={variant} loading={checking} onClick={check.start}>
      {checking ? null : <MailCheck aria-hidden="true" />}
      {checking ? "Checking" : "Check for replies"}
    </Button>
  );
}

const replies = (count: number) => (count === 1 ? "1 new reply" : `${count} new replies`);

/**
 * What the last check found, in a notice that stays until the next one starts. `here` is the
 * request the page is about, so a reply to it needs no link back to the page already open.
 */
export function ReplyCheckResult({
  check,
  here,
  className,
}: {
  check: ReplyCheck;
  here?: string;
  className?: string | undefined;
}) {
  const { phase } = check;
  if (phase.kind === "idle") return null;

  if (phase.kind === "checking") {
    return (
      <p role="status" className="sr-only">
        Checking for replies
      </p>
    );
  }

  if (phase.kind === "too_soon") {
    return (
      <Callout intent="info" className={className}>
        {phase.message}
      </Callout>
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

  if (phase.kind === "error" || phase.outcome.state === "failed") {
    const message = phase.kind === "error" ? phase.message : failureOf(phase.outcome);
    return (
      <Callout
        intent="danger"
        title="Could not check the mailbox"
        className={className}
        action={
          <LinkButton size="sm" to={`/profiles/${check.profileId}/mailbox`}>
            Fix the mailbox
          </LinkButton>
        }
      >
        {message}
      </Callout>
    );
  }

  const { outcome } = phase;
  if (outcome.state !== "done") return null;
  const others = outcome.matchedRequestIds.filter((id) => id !== here);
  const link =
    outcome.matched === 0
      ? null
      : others.length === 1
        ? { to: `/requests/${others[0]}`, label: "Open the request" }
        : others.length > 1
          ? { to: "/requests", label: "See requests" }
          : null;

  return (
    <Callout
      intent={outcome.matched > 0 ? "success" : "info"}
      title={outcome.matched > 0 ? replies(outcome.matched) : "No new replies"}
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
        ? `${outcome.needsReview === 1 ? "1 message needs" : `${outcome.needsReview} messages need`} a look from you.`
        : outcome.matched > 0
          ? "It is on the request's timeline."
          : null}
    </Callout>
  );
}

function failureOf(outcome: MailboxPollOutcome): string {
  return outcome.state === "failed" ? outcome.error : "The check did not finish.";
}
