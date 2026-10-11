import {
  API_ROUTES,
  type FormRequest,
  isActiveStatus,
  type RequestAction,
  type RequestDetail,
  resendEmailKind,
  type TaskSummary,
  tellEvents,
} from "@kickrocks/shared";
import { skipToken } from "@tanstack/react-query";
import { Globe, Mail, MoreHorizontal } from "lucide-react";
import { Fragment, useState } from "react";
import { useParams } from "react-router";
import {
  errorMessage,
  useApiMutation,
  useApiQuery,
  useCurrentProfile,
} from "../../../api/index.js";
import { useBreadcrumbTail } from "../../../components/layout/breadcrumb-context.js";
import {
  Button,
  Callout,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  EntityLink,
  EntityRow,
  ExternalLinkText,
  FactList,
  IconAction,
  InlineError,
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
import {
  BLOCKED_REASON_LABELS,
  CHANNEL_LABELS,
  legalBasisCode,
  REQUEST_ACTION_LABELS,
  RIGHT_LABELS,
  TASK_KIND_LABELS,
} from "../../../lib/labels.js";
import { paths, taskPath } from "../../../lib/paths.js";
import { REQUEST_STATUS_META } from "../../../lib/status.js";
import { AgentPanel } from "../../assign/AgentPanel.js";
import { assigneeTag } from "../../assign/model.js";
import {
  CheckForRepliesAction,
  ReplyCheckResult,
  useReplyCheck,
} from "../../mailbox/check-for-replies.js";
import { gutterTime, RIGHT_TOKENS } from "../format.js";
import { detailRefreshInterval } from "../polling.js";
import { ReplyCard } from "./ReplyCard.js";
import { Timeline } from "./Timeline.js";

const FORM_REQUEST_LEAD: Record<FormRequest["state"], string> = {
  on_form_route:
    "Their reply says this request has to be made another way, so it is on the form route instead of email.",
  unconfirmed:
    "Their reply may say to use a web form or phone. Confirm and the request moves to the form route.",
  no_form_channel:
    "Their reply says this request has to be made another way, and there is no web form we can reach for them. You have to make it yourself.",
};

function formRequestTitle(state: FormRequest["state"], name: string): string {
  return state === "unconfirmed" ? `${name} may want its web form` : `${name} wants its web form`;
}

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
    <div aria-busy="true">
      <span className="sr-only">Loading request</span>
      <PageHeader title="Request" />
      <div className="flex max-w-3xl flex-col gap-5">
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
    </div>
  );
}

function TaskRow({ task, requestId }: { task: TaskSummary; requestId: string }) {
  // A task that only belongs to this request has nowhere else to open, so it is not a link.
  const here = taskPath(task) === paths.request(requestId);
  const assignee = assigneeTag(task);
  return (
    <EntityRow
      to={{ kind: "task", task: here ? { ...task, requestId: null } : task }}
      title={TASK_KIND_LABELS[task.kind]}
      meta={
        <>
          Updated <RelativeTime iso={task.updatedAt} />
          {task.attempts > 1 ? `, attempt ${task.attempts} of ${task.maxAttempts}` : ""}
          {task.status === "blocked" && task.blockedReason
            ? `. Stopped for you: ${BLOCKED_REASON_LABELS[task.blockedReason]}`
            : ""}
        </>
      }
      trailing={
        <>
          {assignee ? <Tag>{assignee}</Tag> : null}
          <TaskStatusMark status={task.status} />
        </>
      }
    />
  );
}

/** Created, sent, due and follow-ups on one wrapping mono line, since each is a few characters. */
function Timing({ request }: { request: RequestDetail }) {
  const day = (iso: string) => gutterTime(iso);
  const parts = [
    `Created ${day(request.createdAt)}`,
    request.sentAt ? `Sent ${day(request.sentAt)}` : "Not sent yet",
    request.dueAt ? `Due ${day(request.dueAt)}` : null,
    request.followUps > 0 ? `Follow-ups ${request.followUps}` : null,
  ].filter((part): part is string => part !== null);
  return (
    <>
      {parts.map((part, index) => (
        <Fragment key={part}>
          <span className="whitespace-nowrap">
            {part}
            {index < parts.length - 1 ? " \u00b7" : ""}
          </span>{" "}
        </Fragment>
      ))}
    </>
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
          actions={<LinkButton to={paths.requests()}>Back to requests</LinkButton>}
        />
      );
    }
    return (
      <>
        <PageHeader title="Request" />
        <Callout
          intent="danger"
          title="Could not load this request"
          action={
            <Button size="sm" onClick={() => query.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Callout>
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
    onError: () => setConfirming(null),
  });

  const check = useReplyCheck(request.profileId, request.id);
  const switchToForm = useApiMutation(API_ROUTES.messageClassify, {
    invalidates: [
      API_ROUTES.requestsGet,
      API_ROUTES.requestsList,
      API_ROUTES.dashboardGet,
      API_ROUTES.reviewQueue,
    ],
    onSuccess: () => toast.success("Moved to the web form"),
  });
  const { profiles } = useCurrentProfile();
  const owner = profiles.find((profile) => profile.id === request.profileId);
  const canCheck = owner?.mailboxConnected;
  const ownerDetail = useApiQuery(
    API_ROUTES.profilesGet,
    request.mailboxId ? { params: { id: request.profileId } } : skipToken,
  );
  const mailbox = ownerDetail.data?.mailbox ?? null;

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
  const latestReply = request.messages.at(-1);
  const showLatest = latestReply !== undefined && latestReply.classification !== "completed";
  const earlierReplies = showLatest ? request.messages.slice(0, -1) : request.messages;
  const agentTask = request.tasks.find(
    (task) => task.kind === "agent" && (task.status === "queued" || task.status === "leased"),
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
  const basisName =
    request.legalBasis === "policy" ? "Their own privacy policy" : (statute?.name ?? null);
  const ChannelGlyph = request.channel === "email" ? Mail : Globe;
  const channelHint =
    request.channel === "email" ? "Sent as an email" : "Submitted through their web form";

  return (
    <>
      <PageHeader
        title={target.name}
        documentTitle={`${target.name}, ${REQUEST_STATUS_META[request.status].label}`}
        description={
          <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <StatusMark status={request.status} />
            <span className="inline-flex items-center gap-1 font-mono text-meta">
              {request.reference}
              <CopyButton iconOnly value={request.reference} label="Copy reference" />
            </span>
          </span>
        }
        actions={
          <>
            {canCheck ? <CheckForRepliesAction check={check} /> : null}
            {menuItems.length > 0 ? (
              <Menu
                align="end"
                items={menuItems}
                trigger={(props) => (
                  <IconAction label="More actions" icon={MoreHorizontal} {...props} />
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
        <ReplyCheckResult check={check} here={request.id} recordedOnTimeline />
        {act.isError ? <InlineError>{errorMessage(act.error)}</InlineError> : null}
        {request.formRequest ? (
          <Callout
            intent="warning"
            title={formRequestTitle(request.formRequest.state, target.name)}
            action={
              request.formRequest.state === "unconfirmed" ? (
                <Button
                  size="sm"
                  loading={switchToForm.isPending}
                  onClick={() =>
                    request.formRequest &&
                    switchToForm.mutate({
                      params: { id: request.formRequest.messageId },
                      body: { classification: "needs_form" },
                    })
                  }
                >
                  Yes, use the form
                </Button>
              ) : undefined
            }
          >
            <p>
              {FORM_REQUEST_LEAD[request.formRequest.state]}
              {request.formRequest.url ? (
                <>
                  {" "}
                  {request.formRequest.fromReply ? "The link they gave: " : "Their opt-out page: "}
                  <ExternalLinkText
                    href={request.formRequest.url}
                    className="[overflow-wrap:anywhere]"
                  >
                    {request.formRequest.url}
                  </ExternalLinkText>
                </>
              ) : null}
            </p>
            {request.formRequest.phone ? (
              <p className="mt-1">
                They also take requests by phone:{" "}
                <span className="font-mono">{request.formRequest.phone}</span>
              </p>
            ) : null}
          </Callout>
        ) : null}
        {showLatest ? (
          <Section label="Latest reply">
            <RowGroup>
              <ReplyCard message={latestReply} requestId={request.id} />
            </RowGroup>
          </Section>
        ) : null}
        {request.status === "needs_verification" ? (
          <Callout
            intent="warning"
            title="The target asked for more details"
            action={
              <LinkButton size="sm" to={paths.reviewItem(`details:${request.id}`)}>
                Review what to send
              </LinkButton>
            }
          >
            Nothing goes out until you choose which details to share.
          </Callout>
        ) : null}
        {agentTask ? (
          <AgentPanel
            task={agentTask}
            pageUrl={target.optOutUrl}
            events={request.events}
            layout="callout"
          />
        ) : null}
        {blocked ? (
          <Callout
            intent="warning"
            title="A task is waiting for you"
            action={
              <LinkButton size="sm" to={paths.reviewItem(`task:${blocked.id}`)}>
                Open in Review
              </LinkButton>
            }
          >
            {blocked.blockedReason
              ? `It stopped for you: ${BLOCKED_REASON_LABELS[blocked.blockedReason]}.`
              : "It stopped and needs a person."}
          </Callout>
        ) : null}
        {request.awaitingConfirmationSince ? (
          <Callout intent="info" title="Waiting for a confirmation email">
            The form was submitted <RelativeTime iso={request.awaitingConfirmationSince} />. The
            link is followed when the email arrives.
          </Callout>
        ) : null}

        {earlierReplies.length > 0 ? (
          <Section label={showLatest ? "Earlier replies" : "Replies"} count={earlierReplies.length}>
            <RowGroup>
              {earlierReplies.map((message) => (
                <ReplyCard key={message.id} message={message} requestId={request.id} />
              ))}
            </RowGroup>
          </Section>
        ) : showLatest ? null : (
          <Section label="Replies" count={0}>
            <p className="py-1 text-ui text-ink-2">No replies yet.</p>
          </Section>
        )}

        <Section label="Summary">
          <FactList
            dense
            items={[
              {
                term: "Target",
                value: <EntityLink to={{ kind: "target", id: target.id, name: target.name }} />,
              },
              ...(owner
                ? [
                    {
                      term: "For",
                      value: (
                        <EntityLink
                          to={{ kind: "profile", id: owner.id, name: owner.displayName }}
                        />
                      ),
                    },
                  ]
                : []),
              ...(mailbox
                ? [
                    {
                      term: "From",
                      value: (
                        <EntityLink
                          to={{
                            kind: "mailbox",
                            profileId: mailbox.profileId,
                            address: mailbox.address,
                          }}
                        />
                      ),
                    },
                  ]
                : []),
              ...(request.campaignId
                ? [
                    {
                      term: "Campaign",
                      value: (
                        <EntityLink
                          to={{
                            kind: "campaign",
                            id: request.campaignId,
                            label: "All requests in it",
                          }}
                        />
                      ),
                    },
                  ]
                : []),
              {
                term: "Channel",
                hint: channelHint,
                value: (
                  <span className="inline-flex items-center gap-1.5">
                    <ChannelGlyph aria-hidden="true" className="size-4 text-ink-2" />
                    <span>{CHANNEL_LABELS[request.channel]}</span>
                  </span>
                ),
              },
              {
                term: "Asked for",
                mono: true,
                value: (
                  <>
                    <span aria-hidden="true">
                      {request.rights.map((right) => RIGHT_TOKENS[right]).join(" \u00b7 ")}
                    </span>
                    <span className="sr-only">
                      {request.rights
                        .map((right, index) =>
                          index === 0
                            ? RIGHT_LABELS[right]
                            : RIGHT_LABELS[right].replace(/^./, (first) => first.toLowerCase()),
                        )
                        .join(" and ")}
                    </span>
                  </>
                ),
              },
              {
                term: "Legal basis",
                mono: true,
                ...(basisName ? { hint: basisName } : {}),
                value: (
                  <>
                    {legalBasisCode(request.legalBasis)}
                    {basisName ? <span className="sr-only">, {basisName}</span> : null}
                  </>
                ),
              },
              { term: "Timing", mono: true, value: <Timing request={request} /> },
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

        <Section label="Tasks" count={request.tasks.length}>
          {request.tasks.length === 0 ? (
            <p className="py-1 text-ui text-ink-2">No tasks for this request yet.</p>
          ) : (
            <RowGroup>
              {request.tasks.map((task) => (
                <TaskRow key={task.id} task={task} requestId={request.id} />
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
