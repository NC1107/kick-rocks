import { API_ROUTES, type SettingsView, type WorkerStatus } from "@kickrocks/shared";
import type { ReactNode } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import {
  Callout,
  Checkbox,
  Row,
  RowGroup,
  Section,
  StatusShapeGlyph,
  useToast,
} from "../../components/ui/index.js";
import { formatDateTime, formatRelative } from "../../lib/format.js";
import type { StatusShape } from "../../lib/status.js";
import { type WorkerState, workerState } from "./model.js";
import { BodyRow, Value } from "./rows.js";

const STATE_MARKS: Record<WorkerState, { label: string; shape: StatusShape; word: string }> = {
  online: { label: "Online", shape: "disc", word: "text-ink-2" },
  offline: { label: "Not responding", shape: "triangle", word: "text-attention-text font-medium" },
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
    never: "Not checked in yet. Targets without a recipe wait in Review.",
    offline: "Silent for a while. Targets without a recipe wait until it is back.",
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
    onError: (error) => toast.error("That did not work", errorMessage(error)),
  });
  return (
    <Checkbox
      label="Let the agent worker take unreviewed targets"
      description="Targets whose bundled recipe you have not approved. Rejected ones always wait for you."
      checked={agent.takeUnreviewed}
      disabled={save.isPending}
      onChange={(event) =>
        save.mutate({ body: { agent: { takeUnreviewed: event.target.checked } } })
      }
    />
  );
}

function WorkerRow({
  kind,
  status,
  now,
  children,
}: {
  kind: WorkerKind;
  status: WorkerStatus | null;
  now: number;
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
                    <time dateTime={status.lastSeenAt} title={formatDateTime(status.lastSeenAt)}>
                      {formatRelative(status.lastSeenAt, { now })}
                    </time>
                  </Value>
                }
              />
              <Row title="Name" trailing={<Value>{status.workerId}</Value>} />
              <Row title="Version" trailing={<Value>{status.version ?? "-"}</Value>} />
              <Row
                title="Doing"
                trailing={<Value>{status.busy ? "Working on a task" : "Waiting for work"}</Value>}
              />
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
}: {
  worker: SettingsView["worker"];
  agent: SettingsView["agent"];
  now: number;
}) {
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
        <WorkerRow key={kind.key} kind={kind} status={worker[kind.key]} now={now}>
          {kind.key === "model" ? <UnreviewedSites agent={agent} /> : null}
        </WorkerRow>
      ))}
    </div>
  );
}
