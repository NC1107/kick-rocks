import {
  API_ROUTES,
  type FormOutcome,
  type NeedsYouItem,
  type ProfileField,
  type SendRow,
} from "@kickrocks/shared";
import { ExternalLink } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import { errorMessage, useApiMutation, useApiQuery } from "../../../api/index.js";
import {
  ConfirmDialog,
  Disclosure,
  type MenuItem,
  TextLink,
  Tooltip,
  useToast,
} from "../../../components/ui/index.js";
import { cn } from "../../../lib/cn.js";
import { PROFILE_FIELD_LABELS } from "../../../lib/labels.js";
import { paths } from "../../../lib/paths.js";
import { ReplyCheckResult, useReplyCheck } from "../../mailbox/check-for-replies.js";
import { HeldItem, Limits, NextRunList, useSecondTick } from "../HeldItems.js";
import { canReportOutcome, REVIEW_INVALIDATES } from "../model.js";
import { SentLog } from "../SentLog.js";
import { destinationOf, fieldRows, isHeld, liveHolds, nextRunHolds } from "../sends-model.js";
import { ActionBar, CardFrame, Steps, Thumbnail } from "./Card.js";
import { Chips, useProfileValues } from "./Chips.js";
import { useFocus } from "./context.js";
import { CHIP_LABELS, KIND_COPY, OTHER_OUTCOMES, sendDetails, WORDS } from "./copy.js";
import { stuckAllowed, useCardMenu } from "./menu.js";
import { clip, clockLeft, itemTitle, maskValue } from "./model.js";
import { ReturnPrompt } from "./ReturnPrompt.js";

const hostOf = (url: string | null): string | undefined => {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
};

function taskOf(item: NeedsYouItem) {
  if (!("task" in item.source)) throw new Error("This card is for a task");
  return item.source.task.task;
}

/** Marks a task done and says "not yet", the two ways the return prompt ends a task. */
function useTaskFlow(item: NeedsYouItem) {
  const focus = useFocus();
  const toast = useToast();
  const task = taskOf(item);
  const outcome = useRef<FormOutcome>("submitted");
  const markDone = useApiMutation(API_ROUTES.taskMarkDone, {
    invalidates: REVIEW_INVALIDATES,
    onSuccess: () => {
      focus.resolved();
      const chosen = OTHER_OUTCOMES.find((other) => other.outcome === outcome.current);
      toast.success(`${chosen?.label ?? "Done"} · ${itemTitle(item)}`);
    },
  });
  const notYet = useApiMutation(API_ROUTES.needsYouNotYet, { invalidates: REVIEW_INVALIDATES });
  const error = [markDone, notYet].find((mutation) => mutation.isError)?.error;
  return {
    task,
    busy: markDone.isPending || notYet.isPending,
    error: error ? errorMessage(error) : undefined,
    done: (chosen: FormOutcome = "submitted") => {
      outcome.current = chosen;
      markDone.mutate({
        params: { id: task.id },
        body: canReportOutcome(task) ? { result: { outcome: chosen } } : {},
      });
    },
    notYet: () =>
      notYet.mutate({ params: { kind: "task", id: task.id }, body: {} }, { onSuccess: focus.next }),
    pending: markDone.isPending,
  };
}

function PromptBar({ item, flow }: { item: NeedsYouItem; flow: ReturnType<typeof useTaskFlow> }) {
  const focus = useFocus();
  return (
    <ReturnPrompt
      question={KIND_COPY[item.kind].question}
      withOutcomes={canReportOutcome(flow.task)}
      busy={flow.busy}
      error={flow.error}
      onYes={() => flow.done("submitted")}
      onNotYet={flow.notYet}
      onSkip={focus.skip}
      onOutcome={flow.done}
    />
  );
}

function Stuck({ show, onClick }: { show: boolean; onClick: () => void }) {
  if (!show) return null;
  return (
    <button
      type="button"
      onClick={onClick}
      className="self-start rounded-xs text-ui text-accent-text underline decoration-accent-text/40 underline-offset-2"
    >
      {WORDS.stuck}
    </button>
  );
}

interface TaskCardProps {
  item: NeedsYouItem;
  /** Set for the kind that checks the mailbox, which owns the check. */
  check?: ReturnType<typeof useReplyCheck>;
}

/** The kinds that send the person to a page: a CAPTCHA, a code, a sign-in, an ID, or a form by hand. */
function TaskCard({ item, check }: TaskCardProps) {
  const focus = useFocus();
  const copy = KIND_COPY[item.kind];
  const flow = useTaskFlow(item);
  const cancelsOnSecond = item.kind === "id";
  const menu = useCardMenu(item, {
    ...(cancelsOnSecond
      ? {
          cancelCopy: {
            title: WORDS.skipTitle,
            description: "Nothing will try it again.",
            confirm: WORDS.skipConfirm,
            keep: WORDS.keep,
            toast: "Skipped",
          },
        }
      : {}),
  });
  const prompting = focus.promptKey === item.key;
  const emailLink = item.kind === "email_link";

  const primary = emailLink
    ? { label: copy.primary, onClick: () => flow.done("submitted"), loading: flow.pending }
    : item.url
      ? { label: copy.primary, onClick: () => focus.openPage(item) }
      : { label: "Already done", onClick: () => focus.setPrompt(item.key) };
  const second = emailLink
    ? focus.mailboxConnected && check
      ? {
          label: copy.second ?? "",
          onClick: check.start,
          loading: check.phase.kind === "checking",
          disabled: check.waitSeconds > 0,
        }
      : null
    : !item.url
      ? null
      : cancelsOnSecond
        ? { label: copy.second ?? "", onClick: menu.openCancel }
        : { label: copy.second ?? "", onClick: () => focus.setPrompt(item.key) };

  return (
    <CardFrame
      item={item}
      menu={menu.menu}
      dialogs={menu.dialogs}
      bar={
        prompting ? (
          <PromptBar item={item} flow={flow} />
        ) : (
          <ActionBar primary={primary} second={second} error={flow.error} />
        )
      }
    >
      <Steps steps={copy.steps} />
      {copy.hint ? <p className="m-0 text-meta text-ink-3">{copy.hint}</p> : null}
      <Chips
        profileId={focus.profileId}
        fields={item.chips}
        extra={emailLink && hostOf(item.url) ? `from ${hostOf(item.url)}` : undefined}
      />
      {check ? <ReplyCheckResult check={check} /> : null}
      {flow.task.hasScreenshot ? <Thumbnail taskId={flow.task.id} /> : null}
      {item.kind === "check_sent" ? <SentDisclosure item={item} /> : null}
      <Stuck show={stuckAllowed(item, focus.agentAccess)} onClick={menu.openHandOff} />
    </CardFrame>
  );
}

/** What left the browser, for the one question where it decides the answer: did the form go out? */
function SentDisclosure({ item }: { item: NeedsYouItem }) {
  const task = taskOf(item);
  const log = useApiQuery(API_ROUTES.taskSends, { params: { id: task.id } });
  const [open, setOpen] = useState(false);
  if (!log.data || log.data.sends.length === 0) return null;
  return (
    <Disclosure title="What was sent" open={open} onOpenChange={setOpen}>
      <SentLog log={log.data} bare />
    </Disclosure>
  );
}

function EmailLinkCard({ item }: { item: NeedsYouItem }) {
  const focus = useFocus();
  const check = useReplyCheck(focus.profileId);
  return <TaskCard item={item} check={check} />;
}

/** A run paused before it sent a request, waiting for the person to decide while it counts down. */
function HoldCard({ item }: { item: NeedsYouItem }) {
  const focus = useFocus();
  const toast = useToast();
  const task = taskOf(item);
  const log = useApiQuery(API_ROUTES.taskSends, {
    params: { id: task.id },
    refetchInterval: 2_000,
  });
  const now = useSecondTick(true);
  const [open, setOpen] = useState(false);
  const live = log.data ? liveHolds(log.data, now).filter(isHeld) : [];
  const current = live[0];
  const decide = useApiMutation(API_ROUTES.taskSendDecide, {
    invalidates: [API_ROUTES.taskSends, ...REVIEW_INVALIDATES],
  });
  const answer = (row: SendRow, decision: "send" | "dont_send") =>
    decide.mutate(
      { params: { id: task.id, sendId: row.id }, body: { decision } },
      {
        onSuccess: () => {
          if (live.length <= 1) focus.resolved();
          toast.success(decision === "send" ? `Sent · ${itemTitle(item)}` : "Held back");
        },
      },
    );
  const finishByHand = {
    id: "finish",
    label: "Finish by hand",
    onSelect: async () => {
      // Opened first, inside the click, because a popup blocker only allows it there.
      if (item.url) window.open(item.url, "_blank", "noopener,noreferrer");
      for (const row of live) {
        await decide.mutateAsync({
          params: { id: task.id, sendId: row.id },
          body: { decision: "dont_send" },
        });
      }
      focus.resolved();
      toast.success("Held back");
    },
  } satisfies MenuItem;
  const menu = useCardMenu(item, { extra: [finishByHand] });
  const request = current?.request;
  const destination = request ? destinationOf(request) : null;
  const fields = request && log.data ? fieldRows(request, log.data.values).slice(0, 3) : [];
  const left = clockLeft(current?.expiresAt ?? null, now);

  return (
    <CardFrame
      item={item}
      menu={menu.menu}
      dialogs={menu.dialogs}
      tagText={left ? `${KIND_COPY.hold.tag} · ${left}` : undefined}
      bar={
        <ActionBar
          enter={false}
          primary={{
            label: KIND_COPY.hold.primary,
            onClick: () => current && answer(current, "send"),
            loading: decide.isPending && decide.variables?.body.decision === "send",
            disabled: !current || decide.isPending,
          }}
          second={{
            label: KIND_COPY.hold.second ?? "",
            onClick: () => current && answer(current, "dont_send"),
            loading: decide.isPending && decide.variables?.body.decision === "dont_send",
            disabled: !current || decide.isPending,
          }}
          error={
            decide.isError
              ? decide.error.status === 409
                ? "That request is no longer waiting."
                : errorMessage(decide.error)
              : undefined
          }
        />
      }
    >
      <Steps steps={current || log.isPending ? KIND_COPY.hold.steps : ["It ran out."]} />
      {live.length > 1 ? (
        <p className="m-0 font-mono text-meta text-ink-3">1 of {live.length} requests</p>
      ) : null}
      {request && destination ? (
        <>
          <p
            className={cn(
              "m-0 break-all font-mono text-ui",
              destination.offSite ? "text-attention-text" : "text-ink",
            )}
          >
            {request.method} {destination.text}
          </p>
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {fields.map((row, index) => (
              <li
                // The same name can repeat in one request.
                // biome-ignore lint/suspicious/noArrayIndexKey: rows are never reordered
                key={`${row.name}-${index}`}
                className="inline-flex max-w-full items-center gap-1.5 rounded-sm border border-line px-2 py-0.5 font-mono text-meta"
              >
                <span className="text-ink-3">{row.name}</span>
                <span className="min-w-0 truncate text-ink">{clip(row.value || "(empty)")}</span>
              </li>
            ))}
          </ul>
          {current && log.data ? (
            <Disclosure title="Show all fields" open={open} onOpenChange={setOpen}>
              <ul className="m-0 list-none p-0">
                <HeldItem taskId={task.id} row={current} values={log.data.values} />
              </ul>
              <Limits />
            </Disclosure>
          ) : null}
        </>
      ) : null}
    </CardFrame>
  );
}

/** A run that stopped before sending and waits for the person to approve it, or to do it themselves. */
function ApproveCard({ item }: { item: NeedsYouItem }) {
  const focus = useFocus();
  const toast = useToast();
  const flow = useTaskFlow(item);
  const { task } = flow;
  const log = useApiQuery(API_ROUTES.taskSends, { params: { id: task.id } });
  const [declined, setDeclined] = useState<string[]>([]);
  // Open from the start, so approving is never done without seeing what goes out.
  const [open, setOpen] = useState(true);
  const held = log.data ? nextRunHolds(log.data).length : 0;
  const options = { invalidates: REVIEW_INVALIDATES };
  const approve = useApiMutation(API_ROUTES.taskApproveSubmit, {
    ...options,
    onSuccess: () => {
      focus.resolved();
      toast.success("Approved · runs again soon");
    },
  });
  const resume = useApiMutation(API_ROUTES.taskResume, {
    ...options,
    onSuccess: () => {
      focus.resolved();
      toast.success("Running again soon");
    },
  });
  const menu = useCardMenu(item);
  const copy = KIND_COPY.approve;
  const error = [approve, resume].find((mutation) => mutation.isError)?.error;
  const settled = log.data !== undefined;
  const approving = held > 0 || !settled;
  const primary = approving
    ? {
        label: copy.primary,
        onClick: () =>
          approve.mutate({ params: { id: task.id }, body: { declineSendIds: declined } }),
        loading: approve.isPending,
        disabled: !settled,
      }
    : {
        label: "Run again",
        onClick: () => resume.mutate({ params: { id: task.id } }),
        loading: resume.isPending,
      };

  return (
    <CardFrame
      item={item}
      menu={menu.menu}
      dialogs={menu.dialogs}
      bar={
        focus.promptKey === item.key ? (
          <PromptBar item={item} flow={flow} />
        ) : (
          <ActionBar
            enter={!approving}
            primary={primary}
            second={
              item.url ? { label: copy.second ?? "", onClick: () => focus.openPage(item) } : null
            }
            error={error ? errorMessage(error) : flow.error}
          />
        )
      }
    >
      <Steps steps={copy.steps} />
      {held > 0 && log.data ? (
        <Disclosure
          title={`Review ${held} request${held === 1 ? "" : "s"}`}
          open={open}
          onOpenChange={setOpen}
        >
          <p className="m-0 text-meta text-ink-3">Each one sends once, next run.</p>
          <NextRunList
            taskId={task.id}
            log={log.data}
            declined={declined}
            onDeclinedChange={setDeclined}
          />
          <Limits />
        </Disclosure>
      ) : null}
      {task.hasScreenshot ? <Thumbnail taskId={task.id} /> : null}
    </CardFrame>
  );
}

function List({ label, values }: { label: string; values: readonly string[] }) {
  if (values.length === 0) return null;
  return (
    <div className="flex gap-3 text-ui">
      <dt className="w-20 shrink-0 text-ink-3">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-ink">{values.join(" · ")}</dd>
    </div>
  );
}

/** A listing a scan found: is it you? "Mine" asks for the removal, and waits a few seconds so it can be taken back. */
function RecordCard({ item }: { item: NeedsYouItem }) {
  const focus = useFocus();
  if (!("match" in item.source)) throw new Error("This card is for a record");
  const { match } = item.source;
  const { fields } = match;
  const menu = useCardMenu(item, {
    extra: [
      {
        id: "opt-out-only",
        label: "Opt-out only",
        onSelect: () => focus.decideRecord(item, "mine", ["opt_out"]),
      },
    ],
  });
  const relatives = fields.relatives ?? [];
  const shownRelatives = [
    ...relatives.slice(0, 3),
    ...(relatives.length > 3 ? [`+${relatives.length - 3}`] : []),
  ];
  const copy = KIND_COPY.record;
  const subline = [`on ${match.targetName}`, fields.age !== undefined ? `age ${fields.age}` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    <CardFrame
      item={item}
      menu={menu.menu}
      dialogs={menu.dialogs}
      bar={
        <ActionBar
          primary={{
            label: copy.primary,
            onClick: () => focus.decideRecord(item, "mine", ["opt_out", "delete"]),
          }}
          second={{
            label: copy.second ?? "",
            onClick: () => focus.decideRecord(item, "not_mine", ["opt_out", "delete"]),
          }}
        />
      }
    >
      <div className="flex items-center justify-between gap-3">
        <p className="m-0 text-meta text-ink-3">{subline}</p>
        <Tooltip content={WORDS.openRecord}>
          <a
            href={match.recordUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={WORDS.openRecord}
            className="-my-2 inline-flex size-(--kr-control-h) shrink-0 items-center justify-center rounded-sm text-ink-3 hover:bg-hover hover:text-ink-2"
          >
            <ExternalLink aria-hidden="true" className="size-4" />
          </a>
        </Tooltip>
      </div>
      <dl className="m-0 flex flex-col gap-1.5">
        <List label="Cities" values={fields.locations.slice(0, 3)} />
        <List label="Relatives" values={shownRelatives} />
        <List
          label="Phones"
          values={(fields.phones ?? []).slice(0, 2).map((phone) => maskValue("phone", phone))}
        />
      </dl>
    </CardFrame>
  );
}

/** What they wrote, cut to two lines, with "More" only when there is more to see. */
function Quote({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  const [clamped, setClamped] = useState(false);
  const line = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const node = line.current;
    if (node && !open) setClamped(node.scrollHeight > node.clientHeight);
  }, [open]);
  return (
    <blockquote className="m-0 border-l-2 border-line-strong pl-3 text-body text-ink">
      <span ref={line} className={cn("block", !open && "line-clamp-2")}>
        {text}
      </span>
      {clamped || open ? (
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="mt-0.5 block rounded-xs text-meta text-accent-text underline decoration-accent-text/40 underline-offset-2"
        >
          {open ? "Less" : "More"}
        </button>
      ) : null}
    </blockquote>
  );
}

/** A target asked for more details. Nothing goes out until the person ticks what to share. */
function DetailsCard({ item }: { item: NeedsYouItem }) {
  const focus = useFocus();
  const toast = useToast();
  if (!("verification" in item.source)) throw new Error("This card is for a request for details");
  const { request, message, requestedFields } = item.source.verification;
  const { values } = useProfileValues(request.profileId, requestedFields);
  const [ticked, setTicked] = useState<ReadonlySet<ProfileField>>(new Set());
  const [declining, setDeclining] = useState(false);
  const menu = useCardMenu(item);
  const fields = requestedFields.filter(
    (field) => ticked.has(field) && values?.[field] !== undefined,
  );
  const send = useApiMutation(API_ROUTES.requestsVerification, {
    invalidates: REVIEW_INVALIDATES,
    onSuccess: (_result, variables) => {
      focus.resolved();
      const sent = variables.body.fields.map((field) => PROFILE_FIELD_LABELS[field].toLowerCase());
      toast.success(`Sent ${sent.join(", ")} to ${request.target.name}`, undefined, {
        action: { kind: "request", id: request.id, reference: request.reference },
      });
    },
  });
  const decline = useApiMutation(API_ROUTES.requestsAct, {
    invalidates: REVIEW_INVALIDATES,
    onSuccess: () => {
      setDeclining(false);
      focus.resolved();
      toast.success(`Cancelled · ${request.target.name}`);
    },
    onError: () => setDeclining(false),
  });
  const toggle = (field: ProfileField) =>
    setTicked((current) => {
      const next = new Set(current);
      if (!next.delete(field)) next.add(field);
      return next;
    });
  const copy = KIND_COPY.details;
  const error = [send, decline].find((mutation) => mutation.isError)?.error;

  return (
    <CardFrame
      item={item}
      menu={menu.menu}
      dialogs={
        <>
          {menu.dialogs}
          <ConfirmDialog
            open={declining}
            onClose={() => setDeclining(false)}
            title={`Cancel the request to ${request.target.name}?`}
            description="Nothing more is sent to them."
            confirmLabel="Cancel request"
            cancelLabel="Keep it"
            destructive
            loading={decline.isPending}
            onConfirm={() =>
              decline.mutate({ params: { id: request.id }, body: { action: "cancel" } })
            }
          />
        </>
      }
      bar={
        <ActionBar
          primary={{
            label: fields.length === 0 ? WORDS.pickWhat : sendDetails(fields.length),
            disabled: fields.length === 0,
            loading: send.isPending,
            onClick: () =>
              send.mutate({ params: { id: request.id }, body: { messageId: message.id, fields } }),
          }}
          second={{ label: copy.second ?? "", onClick: () => setDeclining(true) }}
          error={error ? errorMessage(error) : undefined}
        />
      }
    >
      {message.snippet ? <Quote key={message.id} text={message.snippet} /> : null}
      <section aria-label="They want" className="flex flex-col gap-2">
        <h3 className="text-eyebrow font-semibold text-ink-3">They want</h3>
        {requestedFields.length === 0 ? (
          <p className="m-0 text-ui text-ink-2">They named no detail.</p>
        ) : (
          <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
            {requestedFields.map((field) => {
              const value = values?.[field];
              if (value === undefined) {
                return values ? (
                  <li key={field} className="text-meta text-ink-3">
                    No {PROFILE_FIELD_LABELS[field].toLowerCase()} on file.{" "}
                    <TextLink to={paths.profile(request.profileId)}>Add it</TextLink>
                  </li>
                ) : null;
              }
              const on = ticked.has(field);
              return (
                <li key={field} className="min-w-0 max-w-full">
                  <button
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(field)}
                    className={cn(
                      "inline-flex min-h-control max-w-full items-center gap-1.5 rounded-sm border px-2.5 text-meta transition-colors duration-100 focus-visible:-outline-offset-2 pointer-coarse:min-h-11",
                      on
                        ? "border-accent-fill bg-accent-soft text-ink"
                        : "border-line-strong bg-field hover:bg-hover",
                    )}
                  >
                    <span className="shrink-0 text-ink-3">{CHIP_LABELS[field]}</span>
                    <span className="min-w-0 truncate font-mono text-ink">
                      {maskValue(field, value)}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {copy.hint ? <p className="m-0 text-meta text-ink-3">{copy.hint}</p> : null}
      </section>
    </CardFrame>
  );
}

/** The card for an item, whatever it is. */
export function KindCard({ item }: { item: NeedsYouItem }) {
  switch (item.kind) {
    case "hold":
      return <HoldCard key={item.key} item={item} />;
    case "approve":
      return <ApproveCard key={item.key} item={item} />;
    case "record":
      return <RecordCard key={item.key} item={item} />;
    case "details":
      return <DetailsCard key={item.key} item={item} />;
    case "email_link":
      return <EmailLinkCard key={item.key} item={item} />;
    default:
      return <TaskCard key={item.key} item={item} />;
  }
}
