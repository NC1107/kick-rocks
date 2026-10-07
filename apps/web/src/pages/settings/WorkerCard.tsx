import { API_ROUTES, type SettingsView, type WorkerStatus } from "@kickrocks/shared";
import type { ReactNode } from "react";
import { errorMessage, useApiMutation } from "../../api/index.js";
import {
  Alert,
  Badge,
  Card,
  CardHeader,
  Checkbox,
  DescriptionList,
  useToast,
} from "../../components/ui/index.js";
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

function UnreviewedSites({ agent }: { agent: SettingsView["agent"] }) {
  const toast = useToast();
  const save = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: (view) =>
      toast.success(
        view.agent.takeUnreviewed
          ? "The agent worker will take unreviewed sites"
          : "The agent worker will leave unreviewed sites to you",
      ),
    onError: (error) => toast.error("That did not work", errorMessage(error)),
  });
  return (
    <Checkbox
      label="Let the agent worker take unreviewed sites"
      description="Sites whose bundled recipe you have not approved yet. When off, those tasks wait for you or a connected agent. A site whose recipe you rejected always waits for you."
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
  return (
    <section
      aria-label={kind.title}
      className="flex flex-col gap-3 not-first:border-t not-first:border-line not-first:pt-6"
    >
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
      {children ? <div className="mt-1">{children}</div> : null}
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
            <WorkerRow key={kind.key} kind={kind} status={worker[kind.key]} now={now}>
              {kind.key === "model" ? <UnreviewedSites agent={agent} /> : null}
            </WorkerRow>
          ))}
        </div>
      )}
    </Card>
  );
}
