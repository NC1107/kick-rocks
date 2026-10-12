import {
  type AgentSetupView,
  API_ROUTES,
  agentEnvLines,
  OLLAMA_NATIVE_FROM_DOCKER,
  type SettingsView,
} from "@kickrocks/shared";
import { Bot, ChevronRight, Cpu, Mail } from "lucide-react";
import { useState } from "react";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import {
  Button,
  CopyButton,
  ExternalLinkText,
  Icon,
  InlineError,
  Input,
  Row,
  RowGroup,
  Section,
  Segmented,
  StatusShapeGlyph,
  useToast,
} from "../../../components/ui/index.js";
import { BodyRow, GroupFooter, GroupNote } from "../rows.js";
import {
  type ApplyPlan,
  addressOf,
  applyBody,
  contextWords,
  GATE_LINES,
  PROBE_ERROR_WORDS,
  planApply,
  workerLags,
} from "./setup-model.js";

const GUIDE_URL = "https://github.com/NC1107/kick-rocks/blob/main/docs/agents.md";
const CARD_SIZES = [
  { value: 6, label: "6" },
  { value: 8, label: "8" },
  { value: 12, label: "12" },
  { value: 16, label: "16" },
  { value: 24, label: "24+" },
] as const;

function useSettingsPatch(onSuccess?: () => void) {
  return useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet, API_ROUTES.settingsAgentSetup],
    ...(onSuccess ? { onSuccess } : {}),
  });
}

const COPY_NOTES: Record<ApplyPlan["copyReason"], (workerOllama?: string) => string> = {
  no_worker: () =>
    "No agent worker has reported yet. Put these lines in its .env when you start one.",
  cannot_take_model: () =>
    "This agent worker cannot take a model from here, so put these lines in its .env and restart it.",
  ollama_not_reachable: (address) =>
    `${
      address
        ? `The agent worker cannot reach its Ollama at ${addressOf(address)}`
        : "The agent worker has not reported its Ollama yet"
    }, so this pick comes from the server's Ollama and may not be installed there. Put these lines in its .env once it can.`,
};

function PullRow({ pull, hasModel }: { pull: string; hasModel: boolean }) {
  return (
    <BodyRow className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
      <div className="min-w-0">
        <p className="text-ui font-medium text-ink">
          {hasModel ? "A better fit is not installed" : "No measured model is installed"}
        </p>
        <p className="text-meta text-ink-3">Run this where Ollama runs.</p>
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <code className="min-w-0 break-all font-mono text-meta text-ink-2">{pull}</code>
        <CopyButton value={pull} label="Copy pull command" iconOnly />
      </div>
    </BodyRow>
  );
}

export function RecommendationCard({
  view,
  settings,
  onOpenGate,
}: {
  view: AgentSetupView;
  settings: SettingsView;
  onOpenGate: () => void;
}) {
  const toast = useToast();
  const { agent, reply, reasons, pull } = view.recommendation;
  const worker = view.components.worker;
  const plan = planApply(view, settings);
  const hostedModel = worker?.status.model && worker.status.model.provider !== "ollama";
  const save = useSettingsPatch(() =>
    toast.success("Applied", plan.agentModel ? "The agent worker switches when it checks in." : ""),
  );

  const envLines = agent
    ? agentEnvLines(agent, worker?.ollama?.baseUrl ?? OLLAMA_NATIVE_FROM_DOCKER)
    : [];
  const copyMode = plan.hasAgent && !plan.agentFromHere;
  const nothingToApply = plan.llm === null && plan.agentModel === null;

  return (
    <Section label="Recommended setup">
      <RowGroup>
        {hostedModel && worker?.status.model ? (
          <Row
            icon={Bot}
            wrapTitle
            title={`The agent worker uses ${worker.status.model.provider}, ${worker.status.model.name}; no local recommendation`}
          />
        ) : (
          <Row
            icon={Bot}
            wrapTitle
            wrapDescription
            title={
              agent
                ? `Agent: ${agent.name}, ${contextWords(agent.numCtx)}`
                : "Agent: no local model recommended yet"
            }
            description={reasons.agent}
          />
        )}
        <Row
          icon={Mail}
          wrapTitle
          wrapDescription
          title={
            reply
              ? `Replies: ${reply.name}${reply.sameCopy ? ", same loaded copy" : ""}`
              : "Replies: no model to recommend yet"
          }
          description={reasons.reply}
        />
        {agent ? (
          <Row
            onClick={onOpenGate}
            leading={
              <StatusShapeGlyph
                shape={agent.gate === "passed" || agent.gate === "override" ? "disc" : "triangle"}
                className="ml-1"
              />
            }
            wrapTitle
            title={<span className="font-normal text-ink-2">{GATE_LINES[agent.gate]}</span>}
            trailing={<Icon icon={ChevronRight} />}
          />
        ) : null}
        {pull ? <PullRow pull={pull} hasModel={agent !== null || reply !== null} /> : null}
        <GroupFooter>
          {save.isError ? (
            <InlineError className="mr-auto">{errorMessage(save.error)}</InlineError>
          ) : null}
          {copyMode ? (
            <>
              {plan.hasReply ? (
                <Button
                  variant="secondary"
                  loading={save.isPending}
                  disabled={plan.replyApplied}
                  onClick={() => save.mutate({ body: applyBody(plan) })}
                >
                  {plan.replyApplied ? "Replies applied" : "Use for replies"}
                </Button>
              ) : null}
              <CopyButton
                variant="primary"
                value={envLines.join("\n")}
                label="Copy agent worker settings"
              />
            </>
          ) : (
            <Button
              variant="primary"
              loading={save.isPending}
              disabled={plan.allApplied || nothingToApply}
              onClick={() => save.mutate({ body: applyBody(plan) })}
            >
              {plan.allApplied ? "Applied" : "Apply"}
            </Button>
          )}
        </GroupFooter>
      </RowGroup>
      {copyMode ? (
        <GroupNote>{COPY_NOTES[plan.copyReason](worker?.ollama?.baseUrl)}</GroupNote>
      ) : workerLags(view, settings) ? (
        <GroupNote>
          The agent worker switches the next time it checks in, within half a minute.
        </GroupNote>
      ) : null}
    </Section>
  );
}

/** The answer the person gave to the GPU question, kept where it can be read and changed. */
export function GpuAnswer({ view }: { view: AgentSetupView }) {
  const toast = useToast();
  const [changing, setChanging] = useState(false);
  const { agent, reply } = view.gpu;
  const agentAsked = agent.source === "asked";
  const replyAsked = reply.source === "asked";
  const save = useSettingsPatch(() => {
    toast.success("Saved");
    setChanging(false);
  });
  if (!(agentAsked || replyAsked)) return null;
  const answered = agentAsked ? agent.gib : reply.gib;
  const choose = (value: number) =>
    save.mutate({
      body: {
        agent: {
          gpuMemoryGb: {
            ...(agentAsked ? { worker: value } : {}),
            ...(replyAsked ? { server: value } : {}),
          },
        },
      },
    });
  return (
    <RowGroup>
      <Row
        icon={Cpu}
        title="GPU memory"
        description={`${answered ?? "?"} GB, from your answer`}
        trailing={
          <Button
            size="sm"
            variant="secondary"
            aria-expanded={changing}
            onClick={() => setChanging(!changing)}
          >
            {changing ? "Cancel" : "Change"}
          </Button>
        }
      />
      {changing ? (
        <BodyRow className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Segmented
              legend="GPU memory in GB"
              options={CARD_SIZES}
              value={CARD_SIZES.find((size) => size.value === answered)?.value ?? null}
              disabled={save.isPending}
              onValueChange={choose}
            />
            <span className="font-mono text-meta text-ink-3">GB</span>
          </div>
          {save.isError ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
        </BodyRow>
      ) : null}
    </RowGroup>
  );
}

/** Asked once, because nothing on the machine can say how much memory the GPU running Ollama has. */
export function GpuQuestion({ view }: { view: AgentSetupView }) {
  const toast = useToast();
  const shared = view.sameOllama === "yes" || view.sameOllama === "probably";
  const save = useSettingsPatch(() => toast.success("Saved"));
  const [size, setSize] = useState<number | null>(null);
  const answer = (value: number) => {
    setSize(value);
    const agentSide = view.gpu.agent.gib === null || shared;
    const replySide = view.gpu.reply.gib === null || shared;
    save.mutate({
      body: {
        agent: {
          gpuMemoryGb: {
            ...(agentSide ? { worker: value } : {}),
            ...(replySide ? { server: value } : {}),
          },
        },
      },
    });
  };
  return (
    <RowGroup>
      <BodyRow className="flex flex-col gap-2">
        <p className="text-ui font-medium text-ink">
          Could not tell how much memory the GPU running Ollama has
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            legend="GPU memory in GB"
            options={CARD_SIZES}
            value={size}
            disabled={save.isPending}
            onValueChange={answer}
          />
          <span className="font-mono text-meta text-ink-3">GB</span>
        </div>
        {save.isError ? <InlineError>{errorMessage(save.error)}</InlineError> : null}
      </BodyRow>
    </RowGroup>
  );
}

/** Shown when no Ollama answered anywhere, so the person can point the server at one. */
export function AddressQuestion({
  onFound,
  tried,
}: {
  onFound: (baseUrl: string) => void;
  tried: AgentSetupView["components"]["server"]["endpoints"];
}) {
  const [address, setAddress] = useState("");
  const probe = useApiMutation(API_ROUTES.settingsAgentSetupProbe, {
    onSuccess: (result) => {
      if (result.reachable) onFound(result.baseUrl);
    },
  });
  const failed = probe.data && !probe.data.reachable ? probe.data : null;
  return (
    <RowGroup>
      <BodyRow className="flex flex-col gap-2">
        <label htmlFor="ollama-address" className="text-ui font-medium text-ink">
          Ollama address
        </label>
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (address.trim()) probe.mutate({ body: { baseUrl: address.trim() } });
          }}
        >
          <Input
            id="ollama-address"
            mono
            className="min-w-0 flex-1 basis-64"
            placeholder="http://desktop:11434"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
          />
          <Button type="submit" variant="secondary" loading={probe.isPending}>
            Check
          </Button>
        </form>
        {failed ? (
          <InlineError>
            {addressOf(failed.baseUrl)}:{" "}
            {failed.error ? PROBE_ERROR_WORDS[failed.error] : "nothing answered"}
          </InlineError>
        ) : null}
        {probe.isError ? <InlineError>{errorMessage(probe.error)}</InlineError> : null}
        <p data-user-content className="font-mono text-meta text-ink-3">
          Tried {tried.map((endpoint) => addressOf(endpoint.baseUrl)).join(", ") || "nothing yet"}
        </p>
        <p className="text-meta text-ink-3">
          Ollama steps are in the <ExternalLinkText href={GUIDE_URL}>agents guide</ExternalLinkText>
          .
        </p>
      </BodyRow>
    </RowGroup>
  );
}
