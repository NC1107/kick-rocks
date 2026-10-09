import {
  type AgentPreset,
  API_ROUTES,
  type GateRecord,
  gateCommand,
  type SettingsView,
} from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import {
  Button,
  Checkbox,
  CodeBlock,
  ConfirmDialog,
  InlineError,
  RelativeTime,
  Row,
  RowGroup,
  Section,
  Select,
  StatusShapeGlyph,
  useToast,
} from "../../../components/ui/index.js";
import { GATE_LIMITS } from "../../review/sends-model.js";
import { BodyRow, FactRow, FieldRow, GroupNote, Value } from "../rows.js";
import { describeModel, GATE_SENTENCES, GATE_WORDS, holdChoicesFor, presetGate } from "./gate.js";

type GateView = SettingsView["agent"]["gate"];

function useOverride() {
  const toast = useToast();
  return useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: (_view, { body }) =>
      toast.success(
        body.agent?.gateOverride?.enabled
          ? "Override on"
          : "Override removed, so each submit waits for you again",
      ),
  });
}

function GateMark({ cleared, word }: { cleared: boolean; word: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-meta">
      <StatusShapeGlyph shape={cleared ? "disc" : "triangle"} />
      <span className={cleared ? "text-ink-2" : "font-medium text-attention-text"}>{word}</span>
    </span>
  );
}

function ModelGate({ agent, gate }: { agent: AgentPreset; gate: GateView }) {
  const override = useOverride();
  const [confirming, setConfirming] = useState(false);
  const verdict = presetGate(agent, gate);
  const allowed = verdict.state === "override";
  const body = (enabled: boolean) => ({
    agent: { gateOverride: { provider: "ollama" as const, name: agent.model, enabled } },
  });

  return (
    <>
      <RowGroup>
        <Row
          title={<span className="font-mono">{agent.model}</span>}
          trailing={
            <GateMark cleared={verdict.state === "passed"} word={GATE_WORDS[verdict.state]} />
          }
        />
        <BodyRow className="text-meta text-ink-2">{GATE_SENTENCES[verdict.state]}</BodyRow>
        {gate.current ? (
          <FactRow label="Agent worker runs">
            {describeModel(gate.current.model)},{" "}
            {GATE_WORDS[gate.current.verdict.state].toLowerCase()}
          </FactRow>
        ) : null}
        {verdict.state === "passed" ? null : (
          <BodyRow className="flex flex-col gap-2">
            <Checkbox
              label="Allow without a pass"
              description="The agent worker sends forms with this model without asking you."
              checked={allowed}
              disabled={override.isPending}
              onChange={(event) =>
                event.target.checked ? setConfirming(true) : override.mutate({ body: body(false) })
              }
            />
            {override.isError ? <InlineError>{errorMessage(override.error)}</InlineError> : null}
          </BodyRow>
        )}
      </RowGroup>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Let ${agent.model} send forms alone?`}
        description="Nothing has shown this model is safe here. In the benchmark, models that did not pass sent a second request to a site that said the person was already removed, or tried to type a detail the task does not have."
        confirmLabel="Allow it"
        destructive
        loading={override.isPending}
        onConfirm={() =>
          override.mutate(
            { body: body(true) },
            {
              onSuccess: () => setConfirming(false),
              onError: () => setConfirming(false),
            },
          )
        }
      />
    </>
  );
}

function recordTitle(record: GateRecord): string {
  return record.model.name;
}

function Records({ records }: { records: readonly GateRecord[] }) {
  const override = useOverride();
  return (
    <Section label="Cleared models" count={records.length} as="h3">
      <RowGroup>
        {records.map((record) => (
          <Row
            key={`${record.source}-${record.model.name}-${record.model.thinking}-${record.model.numCtx}`}
            title={<span className="font-mono">{recordTitle(record)}</span>}
            description={
              record.source === "bench" ? (
                <>
                  Passed {record.runs} runs, <RelativeTime iso={record.recordedAt} />
                </>
              ) : (
                <>
                  Allowed by you, <RelativeTime iso={record.recordedAt} />
                </>
              )
            }
            trailing={
              record.source === "override" ? (
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={override.isPending}
                  onClick={() =>
                    override.mutate({
                      body: {
                        agent: {
                          gateOverride: {
                            provider: record.model.provider,
                            name: record.model.name,
                            enabled: false,
                          },
                        },
                      },
                    })
                  }
                >
                  Remove
                </Button>
              ) : (
                <Value>
                  {record.model.thinking === "off" ? "thinking off" : record.model.provider}
                </Value>
              )
            }
          />
        ))}
      </RowGroup>
      {override.isError ? <InlineError>{errorMessage(override.error)}</InlineError> : null}
    </Section>
  );
}

function HoldTime({ minutes }: { minutes: number }) {
  const toast = useToast();
  const save = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: () => toast.success("Saved"),
  });
  return (
    <>
      <Section label="When a send is held" as="h3">
        <RowGroup>
          <FieldRow
            label="Wait for me"
            help="How long the run waits when a model that has not passed the gate tries to send something. While it waits, the agent worker does nothing else."
          >
            <Select
              value={String(minutes)}
              disabled={save.isPending}
              onChange={(event) =>
                save.mutate({
                  body: { agent: { approvalHoldMinutes: Number(event.target.value) } },
                })
              }
            >
              {holdChoicesFor(minutes).map((choice) => (
                <option key={choice.minutes} value={choice.minutes}>
                  {choice.label}
                </option>
              ))}
            </Select>
          </FieldRow>
        </RowGroup>
        {save.isError ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        <GroupNote>
          When it runs out, the request is cancelled and waits in Review. You can approve it for the
          next run. Before a removal starts, the target's cookies and stored data are cleared, so
          the site cannot hand the run something an earlier visit left behind.
        </GroupNote>
      </Section>
      <Section label="What the gate cannot see" as="h3">
        <RowGroup>
          {GATE_LIMITS.map((limit) => (
            <BodyRow key={limit.title} className="text-meta text-ink-2">
              <span className="font-medium text-ink">{limit.title}. </span>
              {limit.text}
            </BodyRow>
          ))}
        </RowGroup>
      </Section>
    </>
  );
}

export function SafetyGate({
  agent,
  gate,
  holdMinutes,
  serverUrl,
}: {
  agent: AgentPreset;
  gate: GateView;
  holdMinutes: number;
  serverUrl: string;
}) {
  return (
    <>
      <Section label="Safety gate" as="h3">
        <ModelGate agent={agent} gate={gate} />
      </Section>
      <HoldTime minutes={holdMinutes} />
      <Section label="Run the gate" as="h3">
        <CodeBlock title="bash" code={gateCommand(agent, serverUrl)} />
        <GroupNote>
          Put the worker token in place of the placeholder, and run it from a checkout.
        </GroupNote>
      </Section>
      {gate.records.length > 0 ? <Records records={gate.records} /> : null}
    </>
  );
}
