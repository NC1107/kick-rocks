import {
  API_ROUTES,
  type RequestAction,
  type RequestDetail,
  resendEmailKind,
  type TaskSummary,
} from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { FileSearch, MoreHorizontal } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router";
import { errorMessage, useApiMutation, useApiQuery } from "../../../api/index.js";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  DescriptionList,
  EmptyState,
  ExternalLinkText,
  IconButton,
  LinkButton,
  Menu,
  type MenuItem,
  PageHeader,
  Skeleton,
  SkeletonText,
  StatusPill,
  TaskStatusPill,
  useToast,
} from "../../../components/ui/index.js";
import { formatDate, formatDateTime, formatRelative } from "../../../lib/format.js";
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
  cancel: "Kick Rocks stops working on this request. Nothing already sent is recalled.",
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
    <div aria-busy="true" className="flex flex-col gap-4">
      <span className="sr-only">Loading request</span>
      <Skeleton className="h-8 w-64" />
      <Card>
        <SkeletonText lines={5} />
      </Card>
      <Card>
        <SkeletonText lines={6} />
      </Card>
    </div>
  );
}

function TaskRow({ task }: { task: TaskSummary }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 py-3 first:pt-0 last:pb-0">
      <span className="min-w-0">
        <span className="block text-base font-medium text-ink">{TASK_KIND_LABELS[task.kind]}</span>
        <span className="block text-sm text-ink-muted">
          Updated <time dateTime={task.updatedAt}>{formatRelative(task.updatedAt)}</time>
          {task.attempts > 1 ? `, attempt ${task.attempts} of ${task.maxAttempts}` : ""}
        </span>
        {task.status === "blocked" && task.blockedReason ? (
          <span className="block text-sm text-ink-muted">
            Stopped for you: {BLOCKED_REASON_LABELS[task.blockedReason].toLowerCase()}
          </span>
        ) : null}
        {task.status === "failed" && task.lastError ? (
          <span className="block text-sm text-danger-text">{task.lastError}</span>
        ) : null}
      </span>
      <TaskStatusPill status={task.status} />
    </li>
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

  if (query.isPending) return <Loading />;

  if (query.isError) {
    if (query.error.status === 404) {
      return (
        <EmptyState
          icon={FileSearch}
          title="Request not found"
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
  const live = request.tasks.filter(
    (task) => task.status !== "done" && task.status !== "cancelled",
  );

  return (
    <>
      <PageHeader
        title={target.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <StatusPill status={request.status} />
            <span className="font-mono text-base">{request.reference}</span>
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

      <div className="flex flex-col gap-5">
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
              <span className="flex flex-wrap gap-2">
                {target.optOutUrl ? (
                  <ExternalLinkText href={target.optOutUrl}>Open the opt-out page</ExternalLinkText>
                ) : null}
                <LinkButton size="sm" to="/review?tab=agents">
                  Do it myself
                </LinkButton>
              </span>
            }
          >
            Kick Rocks has no saved steps for this site, so the form is left to an agent you connect
            in Settings. Nothing happens until one takes it. You can open the page and finish it
            yourself, then mark the task done in Review, or cancel the request.
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
              ? `It stopped at: ${BLOCKED_REASON_LABELS[blocked.blockedReason].toLowerCase()}.`
              : "It stopped and needs a person."}
          </Alert>
        ) : null}
        {request.awaitingConfirmationSince ? (
          <Alert intent="info" title="Waiting for a confirmation email">
            The form was submitted {formatRelative(request.awaitingConfirmationSince)}. Kick Rocks
            follows the link when the email arrives.
          </Alert>
        ) : null}
        {request.lastError ? (
          <Alert intent="danger" title="The last attempt failed">
            {request.lastError}
          </Alert>
        ) : null}

        <Card>
          <CardHeader title="Summary" />
          <DescriptionList
            items={[
              {
                term: "Target",
                description: (
                  <Link
                    to={`/targets/${encodeURIComponent(target.id)}`}
                    className="rounded-xs text-accent-text underline decoration-accent/40 underline-offset-2 hover:decoration-accent"
                  >
                    {target.name}
                  </Link>
                ),
              },
              { term: "Channel", description: CHANNEL_LABELS[request.channel] },
              {
                term: "Asked for",
                description: request.rights
                  .map((right, index) =>
                    index === 0
                      ? RIGHT_LABELS[right]
                      : RIGHT_LABELS[right].replace(/^./, (first) => first.toLowerCase()),
                  )
                  .join(" and "),
              },
              {
                term: "Legal basis",
                description:
                  request.legalBasis === "policy"
                    ? "Their own privacy policy"
                    : (statute?.name ?? request.legalBasis),
              },
              {
                term: "Created",
                description: (
                  <time dateTime={request.createdAt}>{formatDateTime(request.createdAt)}</time>
                ),
              },
              {
                term: "Sent",
                description: request.sentAt ? formatDateTime(request.sentAt) : "Not sent yet",
              },
              {
                term: "Reply due",
                description: request.dueAt ? formatDate(request.dueAt) : "Not set",
              },
              { term: "Follow-ups sent", description: String(request.followUps) },
              ...(request.recordUrl
                ? [
                    {
                      term: "Record",
                      description: (
                        <ExternalLinkText href={request.recordUrl} className="break-all">
                          {request.recordUrl}
                        </ExternalLinkText>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </Card>

        <Card>
          <CardHeader title="Timeline" description="Everything that happened, newest first." />
          <Timeline events={request.events} />
        </Card>

        <Card>
          <CardHeader title="Replies" />
          {request.messages.length === 0 ? (
            <p className="text-base text-ink-muted">No replies yet.</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-line p-0">
              {request.messages.map((message) => (
                <li key={message.id} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                    <p className="min-w-0 break-words text-base font-medium text-ink">
                      {message.subject}
                    </p>
                    <Badge tone="indigo">{CLASSIFICATION_LABELS[message.classification]}</Badge>
                  </div>
                  <p className="break-words text-sm text-ink-muted">
                    From {message.fromAddress},{" "}
                    <time dateTime={message.receivedAt}>{formatDateTime(message.receivedAt)}</time>
                  </p>
                  <div className="mt-1.5">
                    <MessageBody messageId={message.id} snippet={message.snippet} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Tasks"
            description={
              request.tasks.length === 0
                ? undefined
                : live.length > 0
                  ? "Work queued, running, or waiting for you."
                  : "Nothing is running for this request."
            }
          />
          {request.tasks.length === 0 ? (
            <p className="text-base text-ink-muted">No tasks for this request yet.</p>
          ) : (
            <ul className="m-0 list-none divide-y divide-line p-0">
              {request.tasks.map((task) => (
                <TaskRow key={task.id} task={task} />
              ))}
            </ul>
          )}
        </Card>
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
        destructive={confirming === "cancel"}
        loading={act.isPending}
        onConfirm={() => confirming && run(confirming)}
      />
    </>
  );
}
