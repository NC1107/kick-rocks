import type { SettingsView, WorkerStatus } from "@kickrocks/shared";
import { Alert, Badge, Card, CardHeader, DescriptionList } from "../../components/ui/index.js";
import { formatDateTime, formatRelative } from "../../lib/format.js";
import type { Tone } from "../../lib/tone.js";
import { type WorkerState, workerState } from "./model.js";

const STATE_LABELS: Record<WorkerState, { label: string; tone: Tone }> = {
  online: { label: "Online", tone: "green" },
  offline: { label: "Not responding", tone: "amber" },
  never: { label: "Never connected", tone: "neutral" },
};

interface WorkerKind {
  key: "builtin" | "model";
  title: string;
  description: string;
  never: string;
  offline: string;
}

const KINDS: WorkerKind[] = [
  {
    key: "builtin",
    title: "Recipe worker",
    description: "Runs approved recipes in a browser on your home connection.",
    never: "It has not checked in yet. Start it with the same token as the server.",
    offline: "It has not checked in for a while. Recipe tasks wait until it is back.",
  },
  {
    key: "model",
    title: "Agent worker",
    description: "Drives a browser with a language model for sites that have no approved recipe.",
    never: "It has not checked in yet. Without it, those sites wait in Review for you or an agent.",
    offline:
      "It has not checked in for a while. Tasks for sites without a recipe wait until it is back.",
  },
];

function WorkerRow({
  kind,
  status,
  now,
}: {
  kind: WorkerKind;
  status: WorkerStatus | null;
  now: number;
}) {
  const state = workerState(status?.lastSeenAt ?? null, now);
  return (
    <section aria-label={kind.title} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div>
          <h3 className="text-base font-medium text-ink">{kind.title}</h3>
          <p className="text-sm text-ink-muted">{kind.description}</p>
        </div>
        <Badge tone={STATE_LABELS[state].tone}>{STATE_LABELS[state].label}</Badge>
      </div>
      {status ? (
        <DescriptionList
          items={[
            {
              term: "Last seen",
              description: (
                <time dateTime={status.lastSeenAt} title={formatDateTime(status.lastSeenAt)}>
                  {formatRelative(status.lastSeenAt, { now })}
                </time>
              ),
            },
            { term: "Name", description: status.workerId },
            { term: "Version", description: status.version ?? "Unknown" },
            { term: "Doing", description: status.busy ? "Working on a task" : "Waiting for work" },
          ]}
        />
      ) : null}
      {state === "never" ? <p className="text-base text-ink-muted">{kind.never}</p> : null}
      {state === "offline" ? <p className="text-base text-ink-muted">{kind.offline}</p> : null}
    </section>
  );
}

export function WorkerCard({ worker, now }: { worker: SettingsView["worker"]; now: number }) {
  return (
    <Card>
      <CardHeader title="Workers" description="The browsers that fill in forms for you." />
      {!worker.enabled ? (
        <Alert intent="info" title="The workers are switched off">
          Set KICKROCKS_WORKER_TOKEN on the server and start a worker to run forms and scans
          automatically. Until then those tasks wait in Review or go to an agent.
        </Alert>
      ) : (
        <div className="flex flex-col gap-6">
          {KINDS.map((kind) => (
            <WorkerRow key={kind.key} kind={kind} status={worker[kind.key]} now={now} />
          ))}
        </div>
      )}
    </Card>
  );
}
