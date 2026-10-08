import {
  API_ROUTES,
  agentEnvLines,
  DEFAULT_GPU_SIZE_GB,
  GPU_SIZES_GB,
  type GpuSizeGb,
  isOllamaEndpoint,
  MODEL_PRESETS,
  OLLAMA_OPENAI_FROM_DOCKER,
  presetFor,
  type SettingsView,
} from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation } from "../../../api/index.js";
import {
  Button,
  CodeBlock,
  InlineError,
  RowGroup,
  Section,
  Select,
  useToast,
} from "../../../components/ui/index.js";
import { readStorage, STORAGE_KEYS, writeStorage } from "../../../lib/storage.js";
import { BodyRow, FactRow, FieldRow, GroupNote } from "../rows.js";
import { SafetyGate } from "./SafetyGate.js";

function storedGpuSize(): GpuSizeGb {
  const stored = Number(readStorage(STORAGE_KEYS.gpuSize));
  return GPU_SIZES_GB.find((size) => size === stored) ?? DEFAULT_GPU_SIZE_GB;
}

function Expectations({ lines }: { lines: readonly string[] }) {
  return (
    <ul className="m-0 flex list-disc flex-col gap-1 pl-5 text-meta text-ink-2 marker:text-ink-3">
      {lines.map((line) => (
        <li key={line}>{line}</li>
      ))}
    </ul>
  );
}

function ReplyModelSection({
  preset,
  llm,
}: {
  preset: ReturnType<typeof presetFor>;
  llm: SettingsView["llm"];
}) {
  const toast = useToast();
  const { reply } = preset;
  const keepsEndpoint = llm !== null && isOllamaEndpoint(llm.baseUrl);
  const baseUrl = keepsEndpoint ? llm.baseUrl : OLLAMA_OPENAI_FROM_DOCKER;
  const inUse = llm?.model === reply.model && llm.baseUrl === baseUrl;
  const use = useApiMutation(API_ROUTES.settingsPatch, {
    invalidates: [API_ROUTES.settingsGet],
    onSuccess: () => toast.success("Language model saved", `Replies now use ${reply.model}.`),
  });
  return (
    <Section label="Reply model" as="h3">
      <RowGroup>
        <FactRow label="Model">{reply.model}</FactRow>
        {reply.facts.map((fact) => (
          <FactRow key={fact.label} label={fact.label}>
            {fact.value}
          </FactRow>
        ))}
        <BodyRow>
          <Expectations lines={reply.expect} />
        </BodyRow>
        <FactRow label="Base URL">{baseUrl}</FactRow>
        <BodyRow className="flex flex-wrap items-center justify-end gap-2">
          {use.isError ? (
            <InlineError className="mr-auto">{errorMessage(use.error)}</InlineError>
          ) : null}
          <Button
            variant="secondary"
            loading={use.isPending}
            disabled={inUse}
            onClick={() =>
              use.mutate({
                body: {
                  llm: {
                    baseUrl,
                    model: reply.model,
                    ...(llm !== null && !keepsEndpoint ? { apiKey: null } : {}),
                  },
                },
              })
            }
          >
            {inUse ? "In use as the language model" : "Use as the language model"}
          </Button>
        </BodyRow>
      </RowGroup>
    </Section>
  );
}

export function ModelPresets({ settings }: { settings: SettingsView }) {
  const [gpu, setGpu] = useState<GpuSizeGb>(storedGpuSize);
  const preset = presetFor(gpu);
  const { agent } = preset;

  return (
    <>
      <Section label="Local models">
        <RowGroup>
          <FieldRow label="GPU memory">
            <Select
              value={gpu}
              onChange={(event) => {
                const size = Number(event.target.value) as GpuSizeGb;
                setGpu(size);
                writeStorage(STORAGE_KEYS.gpuSize, String(size));
              }}
            >
              {MODEL_PRESETS.map((option) => (
                <option key={option.gpuGb} value={option.gpuGb}>
                  {option.label}
                </option>
              ))}
            </Select>
          </FieldRow>
        </RowGroup>
        <GroupNote>
          Measured with ollama on one 16 GB card. A card with less memory bandwidth is slower.
        </GroupNote>
      </Section>

      <Section label="Agent model" as="h3">
        <RowGroup>
          {agent ? (
            <>
              <FactRow label="Model">{agent.model}</FactRow>
              {agent.facts.map((fact) => (
                <FactRow key={fact.label} label={fact.label}>
                  {fact.value}
                </FactRow>
              ))}
              <BodyRow>
                <Expectations lines={agent.expect} />
              </BodyRow>
            </>
          ) : (
            <BodyRow className="text-meta text-ink-2">{preset.agentFallback}</BodyRow>
          )}
        </RowGroup>
      </Section>

      {agent ? (
        <>
          <Section label="Agent worker settings" as="h3">
            <CodeBlock title=".env" code={agentEnvLines(agent).join("\n")} />
            <GroupNote>
              From a checkout, leave the base URL out and ollama's own address is used.
            </GroupNote>
          </Section>
          <SafetyGate
            agent={agent}
            gate={settings.agent.gate}
            serverUrl={settings.mcp.url.replace(/\/mcp$/, "")}
          />
        </>
      ) : null}

      <ReplyModelSection preset={preset} llm={settings.llm} />
    </>
  );
}
