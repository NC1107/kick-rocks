import {
  API_ROUTES,
  isActiveStatus,
  type RequestAction,
  type RequestDetail,
  resendEmailKind,
  type TaskSummary,
} from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { MoreHorizontal } from "lucide-react";
import { type ReactNode, useState } from "react";
import { Link, useParams } from "react-router";
import { errorMessage, useApiMutation, useApiQuery } from "../../../api/index.js";
import { useBreadcrumbTail } from "../../../components/layout/breadcrumb-context.js";
import {
  Alert,
  Button,
  ConfirmDialog,
  EmptyState,
  ExternalLinkText,
  IconButton,
  LinkButton,
  Menu,
  type MenuItem,
  PageHeader,
  RelativeTime,
  RowGroup,
  Section,
  Skeleton,
  StatusMark,
  Tag,
  TaskStatusMark,
  useToast,
} from "../../../components/ui/index.js";
import { cn } from "../../../lib/cn.js";
import { tellEvents } from "../../../lib/fold.js";
import { formatDate, formatDateTime } from "../../../lib/format.js";
import {
  BLOCKED_REASON_LABELS,
  CHANNEL_LABELS,
  CLASSIFICATION_LABELS,
  REQUEST_ACTION_LABELS,
  RIGHT_LABELS,
  TASK_KIND_LABELS,
} from "../../../lib/labels.js";
import { MessageBody } from "../../review/MessageBody.js";
import { detailRefreshInterval } from "../polling.js";
import { Timeline } from "./Timeline.js";

/** What each action says when it is done, in the verb of the button that started it. */
const ACTION_DONE: Record<RequestAction, string> = {
  cancel: "Request cancelled",
  resend: "Queued to send again",
  mark_confirmed: "Marked as confirmed",
  mark_rejected: "Marked as rejected",
  mark_no_record: "Marked as no record",
};

/** Says which email goes to which address, since a resend cannot be taken back once it is sent. */
function resendWarning(request: RequestDetail, address: string | null): string {
  if (request.channel === "form") {
    return "Kick Rocks fills in the target's web form again.";
  }
  const to = address ? ` to ${address}` : "";
  return resendEmailKind(request.status) === "follow_up" && request.sentAt !== null
    ? `A follow-up email goes${to} from your mailbox. It cannot be recalled.`
    : `The original request email goes${to} again from your mailbox. It cannot be recalled.`;
}

const ACTION_WARNING: Partial<Record<RequestAction, string>> = {
  cancel: "Work on this request stops. Nothing already sent is recalled.",
  mark_confirmed: "Use this when the target confirmed by some other route. It closes the request.",
  mark_rejected: "This records that the target refused the request.",
  mark_no_record: "This closes the request, because the target holds nothing about you.",
};

const CONFIRMED_ACTIONS: readonly RequestAction[] = [
  "mark_confirmed",
  "mark_no_record",
  "mark_rejected",
  "cancel",
];

function Loading() {
  return (
    <div aria-busy="true" className="flex max-w-3xl flex-col gap-5">
      <span className="sr-only">Loading request</span>
      <Skeleton className="h-8 w-64" />
      <Section label="Summary">
        <RowGroup>
          {Array.from({ length: 6 }, (_, row) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: placeholder rows have no identity
            <div key={row} className="flex h-row items-center gap-8 px-3.5">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </RowGroup>
      </Section>
    </div>
  );
}

function Facts({
  items,
}: {
  items: readonly { term: string; value: ReactNode; mono?: boolean }[];
}) {
  return (
    <dl className="m-0 divide-y divide-line overflow-hidden rounded-md border border-line bg-surface">
      {items.map((item) => (
        <div
          key={item.term}
          className="grid min-h-row items-baseline gap-x-6 px-3.5 py-2 sm:grid-cols-[9rem_minmax(0,1fr)]"
        >
          <dt className="text-meta text-ink-3">{item.term}</dt>
          <dd
            className={cn(
              "m-0 min-w-0 break-words text-ui text-ink",
              item.mono && "font-mono text-meta",
            )}
          >
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function TaskRow({ task }: { task: TaskSummary }) {
  return (
    <div className="flex min-h-row flex-wrap items-center justify-between gap-x-4 gap-y-1.5 px-3.5 py-2">
      <div className="min-w-0">
        <p className="text-ui font-medium text-ink">{TASK_KIND_LABELS[task.kind]}</p>
        <p className="text-meta text-ink-3">
          Updated <RelativeTime iso={task.updatedAt} />
          {task.attempts > 1 ? `, attempt ${task.attempts} of ${task.maxAttempts}` : ""}
        </p>
        {task.status === "blocked" && task.blockedReason ? (
          <p className="text-meta text-ink-3">
            Stopped for you: {BLOCKED_REASON_LABELS[task.blockedReason]}
          </p>
        ) : null}
      </div>
      <TaskStatusMark status={task.status} />
    </div>
  );
}

export function Component() {
  const { id } = useParams();
  const query = useApiQuery(
    API_ROUTES.requestsGet,
    id
      ? {
          params: { id },
          refetchInterval: detailRefreshInterval,
        }
      : skipToken,
  );
  useBreadcrumbTail(query.data?.target.name);

  if (query.isPending) return <Loading />;

  if (query.isError) {
    if (query.error.status === 404) {
      return (
        <EmptyState
          title="Request not found."
          description="It may belong to a profile that was deleted."
          actions={<LinkButton to="/requests">Back to requests</LinkButton>}
        />
      );
    }
    return (
      <>
        <PageHeader title="Request" back={{ to: "/requests", label: "Requests" }} />
        <Alert
          intent="danger"
          title="Could not load this request"
          action={
            <Button size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Alert>
      </>
    );
  }

  return <Detail request={query.data} />;
}

function Detail({ request }: { request: RequestDetail }) {
  const toast = useToast();
  const [confirming, setConfirming] = useState<RequestAction | null>(null);

  const act = useApiMutation(API_ROUTES.requestsAct, {
    invalidates: [
      API_ROUTES.requestsGet,
      API_ROUTES.requestsList,
      API_ROUTES.dashboardGet,
      API_ROUTES.reviewQueue,
    ],
    onSuccess: (_data, variables) => {
      setConfirming(null);
      toast.success(ACTION_DONE[variables.body.action]);
    },
    onError: (error) => {
      setConfirming(null);
      toast.error("That did not work", errorMessage(error));
    },
  });

  const [retryError, setRetryError] = useState<string | null>(null);
  const retry = useApiMutation(API_ROUTES.taskRetry, {
    invalidates: [
      API_ROUTES.requestsGet,
      API_ROUTES.requestsList,
      API_ROUTES.dashboardGet,
      API_ROUTES.reviewQueue,
    ],
    onSuccess: () => {
      setRetryError(null);
      toast.success("Task queued to retry");
    },
    onError: (error) => setRetryError(errorMessage(error)),
  });

  const run = (action: RequestAction) =>
    act.mutate({ params: { id: request.id }, body: { action } });
  const can = (action: RequestAction) => request.actions.includes(action);
  const targetDetail = useApiQuery(
    API_ROUTES.targetsGet,
    can("resend") ? { params: { id: request.target.id } } : skipToken,
  );
  const waitingAgent = request.tasks.find(
    (task) => task.kind === "agent" && task.status === "queued",
  );
  const blocked = request.tasks.find((task) => task.status === "blocked");
  const menuItems: MenuItem[] = CONFIRMED_ACTIONS.filter(can).map((action, index) => ({
    id: action,
    label: REQUEST_ACTION_LABELS[action],
    destructive: action === "cancel",
    separatorBefore: action === "cancel" && index > 0,
    onSelect: () => setConfirming(action),
  }));
  const target = request.target;
  const jurisdictions = useApiQuery(API_ROUTES.settingsJurisdictions, { staleTime: 5 * 60_000 });
  const statute = jurisdictions.data?.jurisdictions
    .flatMap((jurisdiction) => jurisdiction.statutes)
    .find((candidate) => candidate.id === request.legalBasis);

  return (
    <>
      <PageHeader
        title={target.name}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatusMark status={request.status} />
            <span className="font-mono text-meta">{request.reference}</span>
          </span>
        }
        back={{ to: "/requests", label: "Requests" }}
        actions={
          <>
            {menuItems.length > 0 ? (
              <Menu
                align="end"
                items={menuItems}
                trigger={(props) => (
                  <IconButton label="More actions" variant="secondary" {...props}>
                    <MoreHorizontal />
                  </IconButton>
                )}
              />
            ) : null}
            {can("resend") ? (
              <Button variant="primary" onClick={() => setConfirming("resend")}>
                {REQUEST_ACTION_LABELS.resend}
              </Button>
            ) : null}
          </>
        }
      />

      <div className="flex max-w-3xl flex-col gap-5">
        {request.status === "needs_verification" ? (
          <Alert
            intent="warning"
            title="The target asked for more details"
            action={
              <LinkButton size="sm" to="/review?tab=verifications">
                Review what to send
              </LinkButton>
            }
          >
            Nothing goes out until you choose which details to share.
          </Alert>
        ) : null}
        {waitingAgent ? (
          <Alert
            intent="warning"
            title="Waiting for an agent"
            action={
              <span className="flex flex-wrap items-center gap-3">
                {target.optOutUrl ? (
                  <ExternalLinkText href={target.optOutUrl}>Open the opt-out page</ExternalLinkText>
                ) : null}
                <LinkButton size="sm" to="/review?tab=agents">
                  Do it myself
                </LinkButton>
              </span>
            }
          >
            There are no saved steps for this target, so an agent you connect in Settings takes the
            form. Open the page and finish it yourself, then mark the task done in Review.
          </Alert>
        ) : null}
        {blocked ? (
          <Alert
            intent="warning"
            title="A task is waiting for you"
            action={
              <LinkButton size="sm" to="/review?tab=blocked">
                Open in Review
              </LinkButton>
            }
          >
            {blocked.blockedReason
              ? `It stopped for you: ${BLOCKED_REASON_LABELS[blocked.blockedReason]}.`
              : "It stopped and needs a person."}
          </Alert>
        ) : null}
        {request.awaitingConfirmationSince ? (
          <Alert intent="info" title="Waiting for a confirmation email">
            The form was submitted <RelativeTime iso={request.awaitingConfirmationSince} />. The
            link is followed when the email arrives.
          </Alert>
        ) : null}

        <Section label="Summary">
          <Facts
            items={[
              {
                term: "Target",
                value: (
                  <Link
                    to={`/targets/${encodeURIComponent(target.id)}`}
                    className="rounded-xs text-accent-text underline decoration-accent-text/40 underline-offset-2 hover:decoration-accent-text"
                  >
                    {target.name}
                  </Link>
                ),
              },
              { term: "Channel", value: CHANNEL_LABELS[request.channel] },
              {
                term: "Asked for",
                value: request.rights
                  .map((right, index) =>
                    index === 0
                      ? RIGHT_LABELS[right]
                      : RIGHT_LABELS[right].replace(/^./, (first) => first.toLowerCase()),
                  )
                  .join(" and "),
              },
              {
                term: "Legal basis",
                value:
                  request.legalBasis === "policy"
                    ? "Their own privacy policy"
                    : (statute?.name ?? request.legalBasis),
              },
              {
                term: "Created",
                mono: true,
                value: (
                  <time dateTime={request.createdAt}>{formatDateTime(request.createdAt)}</time>
                ),
              },
              {
                term: "Sent",
                mono: Boolean(request.sentAt),
                value: request.sentAt ? formatDateTime(request.sentAt) : "Not sent yet",
              },
              {
                term: "Reply due",
                mono: Boolean(request.dueAt),
                value: request.dueAt ? formatDate(request.dueAt) : "Not set",
              },
              { term: "Follow-ups sent", mono: true, value: String(request.followUps) },
              ...(request.recordUrl
                ? [
                    {
                      term: "Record",
                      value: (
                        <ExternalLinkText href={request.recordUrl} className="break-all">
                          {request.recordUrl}
                        </ExternalLinkText>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Section>

        <Section label="Timeline" count={tellEvents(request.events).length}>
          <Timeline
            events={request.events}
            tasks={request.tasks}
            lastError={request.lastError}
            open={isActiveStatus(request.status)}
            onRetry={(taskId) => retry.mutate({ params: { id: taskId } })}
            retrying={retry.isPending}
            retryError={retryError}
          />
        </Section>

        <Section label="Replies" count={request.messages.length}>
          {request.messages.length === 0 ? (
            <p className="py-1 text-ui text-ink-2">No replies yet.</p>
          ) : (
            <RowGroup>
              {request.messages.map((message) => (
                <div key={message.id} className="px-3.5 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="min-w-0 break-words text-ui font-medium text-ink">
                      {message.subject}
                    </p>
                    <Tag>{CLASSIFICATION_LABELS[message.classification]}</Tag>
                  </div>
                  <p className="break-words font-mono text-caption text-ink-3">
                    {message.fromAddress},{" "}
                    <time dateTime={message.receivedAt}>{formatDateTime(message.receivedAt)}</time>
                  </p>
                  <div className="mt-2">
                    <MessageBody messageId={message.id} snippet={message.snippet} />
                  </div>
                </div>
              ))}
            </RowGroup>
          )}
        </Section>

        <Section label="Tasks" count={request.tasks.length}>
          {request.tasks.length === 0 ? (
            <p className="py-1 text-ui text-ink-2">No tasks for this request yet.</p>
          ) : (
            <RowGroup>
              {request.tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </RowGroup>
          )}
        </Section>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title={confirming ? `${REQUEST_ACTION_LABELS[confirming]}?` : ""}
        description={
          confirming === "resend"
            ? resendWarning(request, targetDetail.data?.privacyEmail ?? null)
            : confirming
              ? ACTION_WARNING[confirming]
              : undefined
        }
        confirmLabel={confirming ? REQUEST_ACTION_LABELS[confirming] : "Confirm"}
        cancelLabel={confirming === "cancel" ? "Keep request" : "Cancel"}
        destructive={confirming === "cancel"}
        loading={act.isPending}
        onConfirm={() => confirming && run(confirming)}
      />
    </>
  );
}
