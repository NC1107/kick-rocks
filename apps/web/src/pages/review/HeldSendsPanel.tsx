import type { OutgoingRequest, SendLog, SendRow } from "@kickrocks/shared";
import { API_ROUTES } from "@kickrocks/shared";
import { Info } from "lucide-react";
import { useEffect, useState } from "react";
import { errorMessage, sendScreenshotUrl, useApiMutation } from "../../api/index.js";
import {
  Button,
  Callout,
  Checkbox,
  Dialog,
  InlineError,
  RowGroup,
  Section,
  Tag,
} from "../../components/ui/index.js";
import { cn } from "../../lib/cn.js";
import { REVIEW_INVALIDATES } from "./model.js";
import {
  type Badge,
  carriedSteps,
  countdown,
  destinationOf,
  fieldRows,
  frameLabel,
  GATE_LIMITS,
  heldStatusText,
  isHeld,
  kindLabel,
  liveHolds,
  nextRunHolds,
  unreadableNote,
} from "./sends-model.js";

/** Counts down once a second, which the page-wide clock is too slow for. */
function useSecondTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

function Badges({ badges }: { badges: readonly Badge[] }) {
  return (
    <>
      {badges.map((badge) => (
        <Tag
          key={badge.text}
          tone={badge.tone}
          className="h-auto max-w-full whitespace-normal py-px text-left"
        >
          {badge.text}
        </Tag>
      ))}
    </>
  );
}

function Fields({
  request,
  values,
}: {
  request: OutgoingRequest;
  values: Readonly<Record<string, string>>;
}) {
  const rows = fieldRows(request, values);
  const note = unreadableNote(request);
  if (rows.length === 0 && note === null) {
    return <p className="text-meta text-ink-3">It carries no fields.</p>;
  }
  return (
    <div className="flex flex-col gap-1.5">
      {rows.length > 0 ? (
        <RowGroup>
          {rows.map((row, index) => (
            <div
              // The same name can repeat in one request, so the position is part of the key.
              // biome-ignore lint/suspicious/noArrayIndexKey: rows are never reordered
              key={`${row.where}-${row.name}-${index}`}
              className="grid grid-cols-1 gap-x-3 gap-y-1 px-3.5 py-2 text-meta sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]"
            >
              <span className="break-words font-mono text-ink-3">
                {row.name}
                {row.where === "address" ? (
                  <span className="text-ink-3"> (in the address)</span>
                ) : null}
                {row.where === "header" ? <span className="text-ink-3"> (header)</span> : null}
              </span>
              <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span className="break-all font-mono text-ink">{row.value || "(empty)"}</span>
                <Badges badges={row.badges} />
              </span>
            </div>
          ))}
        </RowGroup>
      ) : null}
      {note ? <p className="text-meta text-ink-3">This body {note}.</p> : null}
    </div>
  );
}

function PageShot({ taskId, sendId }: { taskId: string; sendId: string }) {
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  const url = sendScreenshotUrl(taskId, sendId);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="group block max-h-40 w-full overflow-hidden rounded-sm border border-line bg-canvas text-left"
      >
        <img
          src={url}
          alt="The whole page as it stood when the request was held. Select to enlarge."
          loading="lazy"
          onError={() => setFailed(true)}
          className="w-full object-cover object-top"
        />
        <span className="sr-only">Enlarge the screenshot</span>
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="The page when it was held"
        size="lg"
      >
        <div className="max-h-[70vh] overflow-auto rounded-sm border border-line bg-canvas">
          <img
            src={url}
            alt="The whole page as it stood when the request was held"
            className="h-auto w-full"
          />
        </div>
      </Dialog>
    </>
  );
}

interface ItemProps {
  taskId: string;
  row: SendRow & { request: OutgoingRequest };
  values: Readonly<Record<string, string>>;
  children?: React.ReactNode;
  heading?: React.ReactNode;
}

function HeldItem({ taskId, row, values, heading, children }: ItemProps) {
  const { request } = row;
  const destination = destinationOf(request);
  return (
    <li className="flex flex-col gap-2.5 rounded-md border border-line bg-surface p-3.5">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
        <Tag>{kindLabel(request)}</Tag>
        <span
          className={cn(
            "min-w-0 break-all font-mono text-ui",
            destination.offSite ? "text-attention-text" : "text-ink",
          )}
        >
          {request.method} {destination.text}
        </span>
        {destination.offSite ? <Tag tone="attention">not this site</Tag> : null}
      </div>
      <p className="text-meta text-ink-3">
        From {frameLabel(request)}. {heading}
      </p>
      <Fields request={request} values={values} />
      {row.hasScreenshot ? <PageShot taskId={taskId} sendId={row.id} /> : null}
      {children}
    </li>
  );
}

function Limits() {
  return (
    <details className="group rounded-md border border-line bg-surface px-3.5 py-2.5">
      <summary className="flex cursor-pointer list-none items-center gap-2 text-meta font-medium text-ink-2 marker:hidden">
        <Info aria-hidden="true" strokeWidth={1.5} className="size-4 text-ink-3" />
        What the gate cannot see
      </summary>
      <ul className="mt-2.5 flex flex-col gap-2 text-meta text-ink-2">
        {GATE_LIMITS.map((limit) => (
          <li key={limit.title}>
            <span className="font-medium text-ink">{limit.title}. </span>
            {limit.text}
          </li>
        ))}
      </ul>
    </details>
  );
}

export interface HeldSendsPanelProps {
  taskId: string;
  log: SendLog;
  /** The requests the person keeps out of the next run. */
  declined: readonly string[];
  onDeclinedChange: (ids: string[]) => void;
  /** Called after the person held back the live requests to finish the form by hand. */
  onFinishByHand: () => void;
}

/**
 * What a run is holding for the person: the requests of a run that is waiting right now, each to
 * send or hold back, and the ones a run left for the next time, each to approve or leave out.
 */
export function HeldSendsPanel({
  taskId,
  log,
  declined,
  onDeclinedChange,
  onFinishByHand,
}: HeldSendsPanelProps) {
  const now = useSecondTick(log.sends.some((row) => row.status === "pending_live"));
  const live = liveHolds(log, now);
  const later = nextRunHolds(log);
  const carried = later.some((row) => row.status === "awaiting_next_run") ? carriedSteps(log) : [];
  const decide = useApiMutation(API_ROUTES.taskSendDecide, {
    invalidates: [API_ROUTES.taskSends, ...REVIEW_INVALIDATES],
  });
  const [pending, setPending] = useState<string | null>(null);

  const answer = (row: SendRow, decision: "send" | "dont_send") => {
    setPending(`${row.id}:${decision}`);
    decide.mutate(
      { params: { id: taskId, sendId: row.id }, body: { decision } },
      { onSettled: () => setPending(null) },
    );
  };

  const finishByHand = async () => {
    for (const row of live) {
      await decide.mutateAsync({
        params: { id: taskId, sendId: row.id },
        body: { decision: "dont_send" },
      });
    }
    onFinishByHand();
  };

  if (live.length === 0 && later.length === 0) return null;
  const count = later.length + carried.length;
  const values = log.values;

  return (
    <div className="flex flex-col gap-3">
      {live.length > 0 ? (
        <Section label="Waiting for you" count={live.length} as="h3">
          <p className="mb-2 text-meta text-ink-2">
            The run is paused until you decide. Nothing leaves the browser before then.
          </p>
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {live.filter(isHeld).map((row) => {
              const left = countdown(row.expiresAt, now);
              return (
                <HeldItem
                  key={row.id}
                  taskId={taskId}
                  row={row}
                  values={values}
                  heading={left ? `Held for another ${left}, then it waits for the next run.` : ""}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="primary"
                      size="sm"
                      loading={pending === `${row.id}:send`}
                      disabled={decide.isPending}
                      onClick={() => answer(row, "send")}
                    >
                      Send
                    </Button>
                    <Button
                      size="sm"
                      loading={pending === `${row.id}:dont_send`}
                      disabled={decide.isPending}
                      onClick={() => answer(row, "dont_send")}
                    >
                      Don't send
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={decide.isPending}
                      onClick={() => {
                        finishByHand().catch(() => undefined);
                      }}
                    >
                      Finish by hand
                    </Button>
                    {left ? (
                      <span className="ml-auto font-mono text-meta text-ink-3">
                        <span className="sr-only">Time left: </span>
                        {left}
                      </span>
                    ) : null}
                  </div>
                </HeldItem>
              );
            })}
          </ul>
          {decide.isError ? (
            <InlineError>
              {decide.error.status === 409
                ? "That request is no longer waiting. It lapsed or was decided already."
                : errorMessage(decide.error)}
            </InlineError>
          ) : null}
        </Section>
      ) : null}

      {later.length > 0 ? (
        <Section label="Held for the next run" count={count} as="h3">
          <Callout intent="info">
            Approving sends each of these once, in the next run, if the page asks for the same
            thing. A request that changed is held again. Leave out any you do not want sent.
          </Callout>
          <ul className="m-0 mt-3 flex list-none flex-col gap-3 p-0">
            {carried.filter(isHeld).map((row, index) => (
              <HeldItem
                key={row.id}
                taskId={taskId}
                row={row}
                values={values}
                heading={`Step ${index + 1} already went out once. Approving sends it again, then step ${index + 2}.`}
              />
            ))}
            {later.filter(isHeld).map((row, index) => {
              const left = declined.includes(row.id);
              const step = carried.length + index + 1;
              return (
                <HeldItem
                  key={row.id}
                  taskId={taskId}
                  row={row}
                  values={values}
                  heading={
                    row.resend
                      ? `Step ${step} already went out once. Approving sends it again, then the next step.`
                      : carried.length > 0
                        ? `Step ${step}. ${heldStatusText(row.status)}.`
                        : `${heldStatusText(row.status)}.`
                  }
                >
                  {row.status === "awaiting_next_run" ? (
                    <Checkbox
                      label="Leave this one out"
                      description="A later run refuses it without holding it."
                      checked={left}
                      onChange={(event) =>
                        onDeclinedChange(
                          event.target.checked
                            ? [...declined, row.id]
                            : declined.filter((id) => id !== row.id),
                        )
                      }
                    />
                  ) : null}
                </HeldItem>
              );
            })}
          </ul>
        </Section>
      ) : null}

      <Limits />
    </div>
  );
}
