import { API_ROUTES, type SettingsView, type WorkerStatus } from "@kickrocks/shared";
import type { ReactNode } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import { describeHeldScans } from "../../components/holds/hold-text.js";
import { useScanHolds } from "../../components/holds/use-scan-holds.js";
import {
  Callout,
  Checkbox,
  EntityLink,
  InlineError,
  RelativeTime,
  Row,
  RowGroup,
  Section,
  StatusShapeGlyph,
  useToast,
} from "../../components/ui/index.js";
import { TASK_KIND_LABELS } from "../../lib/labels.js";
import type { StatusShape } from "../../lib/status.js";
import { type WorkerState, workerState } from "./model.js";
import { BodyRow, Value } from "./rows.js";

const STATE_MARKS: Record<WorkerState, { label: string; shape: StatusShape; word: string }> = {
  online: { label: "Worker online", shape: "disc", word: "text-ink-2" },
  offline: { label: "Worker offline", shape: "triangle", word: "text-attention-text font-medium" },
  never: { label: "Never connected", shape: "ring", word: "text-ink-2" },
};

function WorkerMark({ state }: { state: WorkerState }) {
  const mark = STATE_MARKS[state];
  return (
    <span className="inline-flex items-center gap-2 text-meta normal-case tracking-normal">
      <StatusShapeGlyph shape={mark.shape} />
      <span className={mark.word}>{mark.label}</span>
    </span>
  );
}

interface WorkerKind {
  key: "builtin" | "model";
  title: string;
  never: string;
  offline: string;
}

const KINDS: WorkerKind[] = [
  {
    key: "builtin",
    title: "Recipe worker",
    never: "Not checked in yet. Start it with the same token as the server.",
    offline: "Silent for a while. Recipe tasks wait until it is back.",
  },
  {
    key: "model",
    title: "Agent worker",
    never: "Not checked in; recipe-less targets wait in Review.",
    offline: "Silent for a while; recipe-less targets wait.",
  },
];

function UnreviewedSites({ agent }: { agent: SettingsView["agent"] }) {
  const toast = useToast();
  const save = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: (view) =>
      toast.success(
        view.agent.takeUnreviewed
          ? "The agent worker will take unreviewed targets"
          : "The agent worker will leave unreviewed targets to you",
      ),
  });
  return (
    <div className="flex flex-col gap-2">
      <Checkbox
        label="Let the agent worker take unreviewed targets"
        description="Targets whose bundled recipe you have not approved. Rejected ones always wait for you."
        checked={agent.takeUnreviewed}
        disabled={save.isPending}
        onChange={(event) =>
          save.mutate({ body: { agent: { takeUnreviewed: event.target.checked } } })
        }
      />
      {save.isError ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
    </div>
  );
}

/** What the worker is up to: the task it is on, or why it is idle when work is queued. */
function Doing({ status, held }: { status: WorkerStatus; held: string | null }) {
  if (status.resultPending) return "Sending a result the server has not taken";
  const { currentTask } = status;
  if (status.busy) {
    return currentTask ? (
      <>
        Working on{" "}
        <EntityLink
          to={{
            kind: "task",
            task: currentTask,
            label: `${TASK_KIND_LABELS[currentTask.kind].toLowerCase()}${currentTask.targetName ? ` for ${currentTask.targetName}` : ""}`,
          }}
          variant="quiet"
          className="font-sans underline"
        />
      </>
    ) : (
      "Working on a task"
    );
  }
  return held ? `Idle: ${held}` : "Waiting for work";
}

function WorkerRow({
  kind,
  status,
  now,
  held,
  children,
}: {
  kind: WorkerKind;
  status: WorkerStatus | null;
  now: number;
  held: string | null;
  children?: ReactNode;
}) {
  const state = workerState(status?.lastSeenAt ?? null, now);
  const note = state === "never" ? kind.never : state === "offline" ? kind.offline : null;
  return (
    <section aria-label={kind.title}>
      <Section label={kind.title} as="h3" actions={<WorkerMark state={state} />}>
        <RowGroup>
          {status ? (
            <>
              <Row
                title="Last seen"
                trailing={
                  <Value>
                    <RelativeTime iso={status.lastSeenAt} />
                  </Value>
                }
              />
              <Row title="Name" trailing={<Value>{status.workerId}</Value>} />
              <Row title="Version" trailing={<Value>{status.version ?? "-"}</Value>} />
              {status.model ? (
                <Row title="Model" trailing={<Value>{status.model.name}</Value>} />
              ) : null}
              {state === "online" ? (
                <Row
                  title="Doing"
                  trailingBelowOnPhone
                  trailing={
                    <Value>
                      <Doing status={status} held={held} />
                    </Value>
                  }
                />
              ) : null}
            </>
          ) : null}
          {note ? <BodyRow className="text-meta text-ink-2">{note}</BodyRow> : null}
          {children ? <BodyRow>{children}</BodyRow> : null}
        </RowGroup>
      </Section>
    </section>
  );
}

export function WorkerCard({
  worker,
  agent,
  now,
  quietEndHour,
}: {
  quietEndHour: number;
  worker: SettingsView["worker"];
  agent: SettingsView["agent"];
  now: number;
}) {
  const scans = useScanHolds();
  const held = scans ? describeHeldScans(scans, quietEndHour) : null;
  if (!worker.enabled) {
    return (
      <Section label="Workers">
        <Callout intent="info" title="The workers are switched off">
          Set KICKROCKS_WORKER_TOKEN on the server and start a worker to run forms and scans
          automatically. Until then those tasks wait in Review or go to an agent.
        </Callout>
      </Section>
    );
  }
  return (
    <div className="flex flex-col gap-4">
      {KINDS.map((kind) => (
        <WorkerRow key={kind.key} kind={kind} status={worker[kind.key]} now={now} held={held}>
          {kind.key === "model" ? <UnreviewedSites agent={agent} /> : null}
        </WorkerRow>
      ))}
    </div>
  );
}
