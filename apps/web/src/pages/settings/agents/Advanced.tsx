import {
  type AgentModelChoice,
  type AgentSetupView,
  API_ROUTES,
  agentEnvLines,
  BENCH_NUM_CTX,
  type GateVerdict,
  measuredModel,
  measuredThinking,
  OLLAMA_NATIVE_FROM_DOCKER,
  type SettingsView,
} from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import {
  Button,
  CodeBlock,
  Disclosure,
  InlineError,
  RowGroup,
  Section,
  Select,
  useToast,
} from "../../../components/ui/index.js";
import { BodyRow, FactRow, FieldRow, GroupFooter, GroupNote } from "../rows.js";
import { SafetyGate } from "./SafetyGate.js";
import { addressOf, gigabytes, PROBE_ERROR_WORDS } from "./setup-model.js";

const CONTEXTS = [8192, 16_384, 32_768, 65_536, 131_072] as const;

function Expectations({ lines }: { lines: readonly string[] }) {
  return (
    <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-meta text-ink-2 marker:text-ink-3">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function modelOption(name: string): string {
  const measured = measuredModel(name);
  if (!measured) return `${name} (not measured)`;
  const agent = measured.agent
    ? `${measured.agent.successes} of ${measured.agent.runs} runs`
    : "no agent run";
  return `${name} (${agent}, ${measured.memoryGiB} GiB)`;
}

/** Choose both models by hand from what is installed, with the numbers that were measured for each. */
function ManualChoice({ view, settings }: { view: AgentSetupView; settings: SettingsView }) {
  const toast = useToast();
  const worker = view.components.worker;
  const agentInstalled = worker?.ollama?.models.map((model) => model.name) ?? [];
  const replyEndpoint = view.components.server.endpoints.find(
    (endpoint) => endpoint.baseUrl === view.replyEndpoint,
  );
  const replyInstalled = replyEndpoint?.models.map((model) => model.name) ?? [];

  const start = settings.agent.model ?? view.recommendation.agent;
  const [agentName, setAgentName] = useState(start?.name ?? agentInstalled[0] ?? "");
  const [thinking, setThinking] = useState<"default" | "off">(
    start?.thinking ?? measuredThinking(agentName),
  );
  const [numCtx, setNumCtx] = useState<number>(start?.numCtx ?? BENCH_NUM_CTX);
  const [replyName, setReplyName] = useState(
    settings.llm?.model ?? view.recommendation.reply?.name ?? replyInstalled[0] ?? "",
  );

  const save = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet, API_ROUTES.settingsAgentSetup],
    onSuccess: () => toast.success("Saved"),
  });
  const choice: AgentModelChoice = { name: agentName, thinking, numCtx };
  const canSetAgent = worker?.acceptsAgentModel === true && agentName !== "";
  const agentMeasured = measuredModel(agentName);
  const replyMeasured = measuredModel(replyName);

  return (
    <>
      <Section label="Choose the models by hand" as="h3">
        <RowGroup>
          <FieldRow label="Agent model">
            <Select
              mono
              value={agentName}
              disabled={agentInstalled.length === 0}
              onChange={(event) => {
                setAgentName(event.target.value);
                setThinking(measuredThinking(event.target.value));
              }}
            >
              {agentInstalled.length === 0 ? <option value="">None installed</option> : null}
              {agentInstalled.map((name) => (
                <option key={name} value={name}>
                  {modelOption(name)}
                </option>
              ))}
            </Select>
          </FieldRow>
          <FieldRow label="Context">
            <Select mono value={numCtx} onChange={(event) => setNumCtx(Number(event.target.value))}>
              {[...new Set([...CONTEXTS, numCtx])]
                .sort((a, b) => a - b)
                .map((size) => (
                  <option key={size} value={size}>
                    {Math.round(size / 1024)}k tokens
                  </option>
                ))}
            </Select>
          </FieldRow>
          <FieldRow label="Thinking">
            <Select
              value={thinking}
              onChange={(event) => setThinking(event.target.value as "default" | "off")}
            >
              <option value="default">Model default</option>
              <option value="off">Off</option>
            </Select>
          </FieldRow>
          <GroupFooter>
            {worker && !worker.acceptsAgentModel ? (
              <span className="mr-auto text-meta text-ink-3">
                This agent worker cannot take a model from here.
              </span>
            ) : null}
            <Button
              variant="secondary"
              loading={save.isPending}
              disabled={!canSetAgent}
              onClick={() => save.mutate({ body: { agent: { model: choice } } })}
            >
              Use this agent model
            </Button>
          </GroupFooter>
        </RowGroup>
        <RowGroup className="mt-2">
          <FieldRow label="Reply model">
            <Select
              mono
              value={replyName}
              disabled={replyInstalled.length === 0}
              onChange={(event) => setReplyName(event.target.value)}
            >
              {replyInstalled.length === 0 ? <option value="">None installed</option> : null}
              {replyInstalled.map((name) => (
                <option key={name} value={name}>
                  {modelOption(name)}
                </option>
              ))}
            </Select>
          </FieldRow>
          <GroupFooter>
            <Button
              variant="secondary"
              loading={save.isPending}
              disabled={replyName === "" || view.replyEndpoint === null}
              onClick={() =>
                view.replyEndpoint
                  ? save.mutate({
                      body: {
                        llm: { baseUrl: `${view.replyEndpoint}/v1`, model: replyName },
                      },
                    })
                  : undefined
              }
            >
              Use for replies
            </Button>
          </GroupFooter>
        </RowGroup>
        {save.isError ? (
          <InlineError className="mt-2">{errorMessage(save.error)}</InlineError>
        ) : null}
      </Section>

      <Section label="What the benchmark measured" as="h3">
        <RowGroup>
          {agentMeasured?.agent ? (
            <>
              <FactRow label={`Agent: ${agentMeasured.name}`}>
                {agentMeasured.agent.successes} of {agentMeasured.agent.runs} runs
              </FactRow>
              <FactRow label="Memory">{agentMeasured.memoryGiB} GiB</FactRow>
              <FactRow label="Time per task">{agentMeasured.agent.secondsPerTask} s</FactRow>
              <BodyRow>
                <Expectations lines={agentMeasured.agent.expect} />
              </BodyRow>
            </>
          ) : (
            <BodyRow className="text-meta text-ink-2">
              {agentName === ""
                ? "No agent model is chosen."
                : `${agentName} was not measured as an agent, so nothing here says how it behaves.`}
            </BodyRow>
          )}
        </RowGroup>
        <RowGroup className="mt-2">
          {replyMeasured?.reply ? (
            <>
              <FactRow label={`Replies: ${replyMeasured.name}`}>
                {replyMeasured.reply.accuracyPct}% right
              </FactRow>
              <FactRow label="Median time">{replyMeasured.reply.medianSeconds} s</FactRow>
              <BodyRow>
                <Expectations lines={replyMeasured.reply.expect} />
              </BodyRow>
            </>
          ) : (
            <BodyRow className="text-meta text-ink-2">
              {replyName === ""
                ? "No reply model is chosen."
                : `${replyName} was not measured for replies.`}
            </BodyRow>
          )}
        </RowGroup>
        <GroupNote>
          Measured with ollama on one 16 GB card. A card with less memory bandwidth is slower.
        </GroupNote>
      </Section>
    </>
  );
}

/** The lines for the agent worker's .env, and the way back to what the worker was started with. */
function EnvLines({
  view,
  settings,
  model,
}: {
  view: AgentSetupView;
  settings: SettingsView;
  model: { name: string; thinking: "default" | "off" } | null;
}) {
  const toast = useToast();
  const reset = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet, API_ROUTES.settingsAgentSetup],
    onSuccess: () => toast.success("The agent worker uses its own setting again"),
  });
  const baseUrl = view.components.worker?.ollama?.baseUrl ?? OLLAMA_NATIVE_FROM_DOCKER;
  return (
    <Section label="Agent worker settings" as="h3">
      {model ? (
        <CodeBlock title=".env" code={agentEnvLines(model, baseUrl).join("\n")} />
      ) : (
        <RowGroup>
          <BodyRow className="text-meta text-ink-2">No agent model is recommended yet.</BodyRow>
        </RowGroup>
      )}
      <GroupNote>
        These start the agent worker on this model by itself. From a checkout, leave the base URL
        out and ollama's own address is used.
      </GroupNote>
      {settings.agent.model ? (
        <RowGroup className="mt-2">
          <GroupFooter>
            {reset.isError ? (
              <InlineError className="mr-auto">{errorMessage(reset.error)}</InlineError>
            ) : null}
            <Button
              variant="secondary"
              loading={reset.isPending}
              onClick={() => reset.mutate({ body: { agent: { model: null } } })}
            >
              Use the worker's own setting
            </Button>
          </GroupFooter>
        </RowGroup>
      ) : null}
    </Section>
  );
}

/** Every address that was tried, what each answered, and what is loaded where. */
function DetectionDetails({
  view,
  onRecheck,
  rechecking,
}: {
  view: AgentSetupView;
  onRecheck: () => void;
  rechecking: boolean;
}) {
  const worker = view.components.worker;
  return (
    <Section label="Detection details" as="h3">
      <RowGroup>
        {view.components.server.endpoints.map((endpoint) => (
          <FactRow key={endpoint.baseUrl} label={addressOf(endpoint.baseUrl)}>
            {endpoint.reachable
              ? `v${endpoint.version ?? "?"}, ${endpoint.models.length} models${
                  endpoint.loaded.length > 0
                    ? `, loaded: ${endpoint.loaded
                        .map((model) => `${model.name} ${gigabytes(model.sizeVramBytes)} on GPU`)
                        .join(", ")}`
                    : ""
                }`
              : endpoint.error
                ? PROBE_ERROR_WORDS[endpoint.error]
                : "nothing answered"}
          </FactRow>
        ))}
        {worker?.ollama ? (
          <FactRow label={`${addressOf(worker.ollama.baseUrl)} (agent worker)`}>
            {worker.ollama.reachable
              ? `v${worker.ollama.version ?? "?"}, ${worker.ollama.models.length} models${
                  worker.ollama.colocated ? ", on the worker's machine" : ", on another machine"
                }`
              : worker.ollama.error
                ? PROBE_ERROR_WORDS[worker.ollama.error]
                : "nothing answered"}
          </FactRow>
        ) : null}
        {worker?.host ? (
          <FactRow label="Worker machine">
            {worker.host.hostname}, {worker.host.cpuCores} cores,{" "}
            {gigabytes(worker.host.memoryBytes)} memory
          </FactRow>
        ) : null}
        <FactRow label="Same Ollama">{view.sameOllama}</FactRow>
        <GroupFooter>
          <Button variant="secondary" loading={rechecking} onClick={onRecheck}>
            Recheck
          </Button>
        </GroupFooter>
      </RowGroup>
    </Section>
  );
}

/**
 * The safety gate alone, for while detection is still running or has failed. The gate reads what
 * the server saved and needs no probing, so it stays reachable.
 */
export function AdvancedGate({
  settings,
  open,
  onOpenChange,
}: {
  settings: SettingsView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const saved = settings.agent.model;
  const { current } = settings.agent.gate;
  const verdict: GateVerdict =
    saved && current?.model.name === saved.name
      ? current.verdict
      : { state: "unproven", unattended: false, record: null };
  return (
    <Disclosure
      title="Advanced"
      description="The safety gate"
      open={open}
      onOpenChange={onOpenChange}
    >
      <SafetyGate
        agent={saved ? { name: saved.name, thinking: saved.thinking } : null}
        verdict={verdict}
        installed={null}
        gate={settings.agent.gate}
        holdMinutes={settings.agent.approvalHoldMinutes}
        serverUrl={settings.mcp.url.replace(/\/mcp$/, "")}
      />
    </Disclosure>
  );
}

/** Everything the setup section decides for the person, open to read and change by hand. */
export function Advanced({
  view,
  settings,
  open,
  onOpenChange,
  onRecheck,
  rechecking,
}: {
  view: AgentSetupView;
  settings: SettingsView;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecheck: () => void;
  rechecking: boolean;
}) {
  const shown = settings.agent.model ?? view.recommendation.agent;
  const verdict: GateVerdict = (shown &&
    view.installedGate.find((entry) => entry.name === shown.name)?.verdict) || {
    state: "unproven",
    unattended: false,
    record: null,
  };
  return (
    <Disclosure
      title="Advanced"
      description="Choose by hand, what was measured, the safety gate, how it was detected"
      open={open}
      onOpenChange={onOpenChange}
    >
      <ManualChoice key={`${settings.agent.model?.name ?? ""}`} view={view} settings={settings} />
      <EnvLines view={view} settings={settings} model={shown} />
      <SafetyGate
        agent={shown ? { name: shown.name, thinking: shown.thinking } : null}
        verdict={verdict}
        installed={view.installedGate}
        gate={settings.agent.gate}
        holdMinutes={settings.agent.approvalHoldMinutes}
        serverUrl={settings.mcp.url.replace(/\/mcp$/, "")}
      />
      <DetectionDetails view={view} onRecheck={onRecheck} rechecking={rechecking} />
    </Disclosure>
  );
}
