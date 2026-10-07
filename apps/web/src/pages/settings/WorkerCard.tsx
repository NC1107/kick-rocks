import type { SettingsView } from "@kickrocks/shared";
import { Alert, Badge, Card, CardHeader, DescriptionList } from "../../components/ui/index.js";
import { formatDateTime, formatRelative } from "../../lib/format.js";
import type { Tone } from "../../lib/tone.js";
import { type WorkerState, workerState } from "./model.js";

const STATE_LABELS: Record<WorkerState, { label: string; tone: Tone }> = {
  online: { label: "Online", tone: "green" },
  offline: { label: "Not responding", tone: "amber" },
  never: { label: "Never connected", tone: "neutral" },
};

export function WorkerCard({ worker, now }: { worker: SettingsView["worker"]; now: number }) {
  const status = worker.status;
  const state = workerState(status?.lastSeenAt ?? null, now);
  return (
    <Card>
      <CardHeader
        title="Worker"
        description="The browser that fills in forms on your home connection."
      />
      {!worker.enabled ? (
        <Alert intent="info" title="The worker is switched off">
          Set KICKROCKS_WORKER_TOKEN on the server and start the worker to run forms and scans
          automatically. Until then those tasks wait in Review or go to an agent.
        </Alert>
      ) : (
        <>
          <DescriptionList
            items={[
              {
                term: "Status",
                description: (
                  <Badge tone={STATE_LABELS[state].tone}>{STATE_LABELS[state].label}</Badge>
                ),
              },
              ...(status
                ? [
                    {
                      term: "Last seen",
                      description: (
                        <time
                          dateTime={status.lastSeenAt}
                          title={formatDateTime(status.lastSeenAt)}
                        >
                          {formatRelative(status.lastSeenAt, { now })}
                        </time>
                      ),
                    },
                    { term: "Name", description: status.workerId },
                    { term: "Version", description: status.version ?? "Unknown" },
                    {
                      term: "Doing",
                      description: status.busy ? "Working on a task" : "Waiting for work",
                    },
                  ]
                : []),
            ]}
          />
          {state === "never" ? (
            <p className="mt-4 text-base text-ink-muted">
              The worker has not checked in yet. Start it with the same token as the server.
            </p>
          ) : null}
          {state === "offline" ? (
            <p className="mt-4 text-base text-ink-muted">
              It has not checked in for a while. Tasks wait until it is back.
            </p>
          ) : null}
        </>
      )}
    </Card>
  );
}
