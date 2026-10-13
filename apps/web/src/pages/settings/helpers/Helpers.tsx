import { API_ROUTES, type SettingsView } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiMutation, useApiQuery } from "../../../api/index.js";
import {
  Button,
  Callout,
  Dialog,
  ExternalLinkText,
  Field,
  InfoTip,
  InlineError,
  Input,
  RowGroup,
  Section,
  SkeletonText,
} from "../../../components/ui/index.js";
import { McpCard } from "../agents/McpCard.js";
import { BodyRow } from "../rows.js";
import { ConnectedAgents } from "./ConnectedAgents.js";
import { CommandPanel, HelperRow } from "./HelperRow.js";
import {
  AGENT_GUIDE_URL,
  accessReading,
  agentModelReading,
  type HelperReading,
  probedReading,
  replyReading,
  triedAddresses,
  WORKER_COMMANDS,
  workerReading,
} from "./helpers-model.js";

const IDLE_POLL_MS = 15_000;
const WAITING_POLL_MS = 5000;

type CommandKey = keyof typeof WORKER_COMMANDS;

function WorkerHelper({
  name,
  command,
  reading,
  open,
  onOpenChange,
}: {
  name: string;
  command: string;
  reading: HelperReading;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const online = reading.state === "ok";
  return (
    <HelperRow
      name={name}
      reading={reading}
      action={
        online && !open ? null : (
          <Button variant="secondary" aria-expanded={open} onClick={() => onOpenChange(!open)}>
            {open ? "Hide command" : "Show command"}
          </Button>
        )
      }
      below={open ? <CommandPanel command={command} online={online} /> : null}
    />
  );
}

function AccessHelper({ mcp }: { mcp: SettingsView["mcp"] }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <HelperRow
        name="Agent access"
        reading={accessReading(mcp)}
        action={
          <Button variant="secondary" onClick={() => setOpen(true)}>
            Set up
          </Button>
        }
      />
      <Dialog open={open} onClose={() => setOpen(false)} title="Agent access" size="lg">
        {open ? <McpCard mcp={mcp} /> : null}
      </Dialog>
    </>
  );
}

/**
 * An Ollama address and the one helper that uses it. Each model row keeps its own field and
 * result, because the reply model and the agent model run on different machines.
 */
function ModelHelper({
  name,
  use,
  reading,
  placeholder,
  tried,
  onFound,
  onRecheck,
  rechecking,
}: {
  name: string;
  use: string;
  reading: HelperReading;
  placeholder: string;
  tried?: string;
  onFound?: (baseUrl: string) => void;
  onRecheck: () => void;
  rechecking: boolean;
}) {
  const [address, setAddress] = useState("");
  const probe = useApiMutation(API_ROUTES.settingsAgentSetupProbe, {
    onSuccess: (result) => {
      if (result.reachable) onFound?.(result.baseUrl);
    },
  });
  const shown = probe.data ? probedReading(probe.data) : reading;
  const helpLine = (
    <>
      {use}
      {shown.state === "ok" ? null : (
        <>
          {" · "}
          <ExternalLinkText href={AGENT_GUIDE_URL}>Guide</ExternalLinkText>
        </>
      )}
    </>
  );

  const check = () => {
    const typed = address.trim();
    if (typed === "") {
      probe.reset();
      onRecheck();
      return;
    }
    probe.mutate({ body: { baseUrl: typed } });
  };

  return (
    <HelperRow
      as="form"
      name={name}
      reading={shown}
      onSubmit={check}
      detailExtra={
        tried && shown.state === "missing" ? (
          <InfoTip text={tried} label={`Addresses tried for ${name.toLowerCase()}`} />
        ) : null
      }
      below={
        <div className="flex flex-col gap-1.5">
          <Field label={`${name} address`} help={helpLine} className="gap-1">
            <div className="flex items-center gap-2">
              <Input
                mono
                autoComplete="off"
                spellCheck={false}
                placeholder={placeholder}
                value={address}
                onChange={(event) => {
                  setAddress(event.target.value);
                  probe.reset();
                }}
              />
              <Button type="submit" variant="secondary" loading={probe.isPending || rechecking}>
                Check
              </Button>
            </div>
          </Field>
          {probe.isError ? <InlineError>{errorMessage(probe.error)}</InlineError> : null}
        </div>
      }
    />
  );
}

/** Everything Kick Rocks relies on that runs outside the server, one row each. */
export function Helpers() {
  const [open, setOpen] = useState<Record<CommandKey, boolean>>({ browser: false, agent: false });
  const waiting = open.browser || open.agent;
  const settings = useApiQuery(API_ROUTES.settingsGet, {
    refetchInterval: waiting ? WAITING_POLL_MS : IDLE_POLL_MS,
  });
  // An address the person typed, probed first and kept for this visit.
  const [asked, setAsked] = useState<string | null>(null);
  const setup = useApiQuery(API_ROUTES.settingsAgentSetup, {
    query: asked ? { ask: asked } : {},
  });

  const toggle = (key: CommandKey) => (next: boolean) =>
    setOpen((current) => ({ ...current, [key]: next }));

  if (settings.isPending) {
    return (
      <Section label="Helpers">
        <RowGroup aria-busy="true">
          <BodyRow>
            <span className="sr-only">Loading helpers</span>
            <SkeletonText lines={4} />
          </BodyRow>
        </RowGroup>
      </Section>
    );
  }
  if (settings.isError) {
    return (
      <Section label="Helpers">
        <Callout
          intent="danger"
          title="Could not load the helpers"
          action={
            <Button size="sm" onClick={() => settings.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(settings.error)}
        </Callout>
      </Section>
    );
  }

  const { worker, mcp } = settings.data;
  const now = settings.dataUpdatedAt;
  const view = setup.data;
  const agentOllama = view?.components.worker?.ollama?.baseUrl;
  const replyAddress = view?.replyEndpoint ?? null;
  const recheck = () => setup.refetch();

  return (
    <>
      <Section label="Helpers">
        <RowGroup>
          <WorkerHelper
            name="Browser"
            command={WORKER_COMMANDS.browser}
            reading={workerReading(worker.enabled, worker.builtin, now)}
            open={open.browser}
            onOpenChange={toggle("browser")}
          />
          <WorkerHelper
            name="Agent"
            command={WORKER_COMMANDS.agent}
            reading={workerReading(worker.enabled, worker.model, now)}
            open={open.agent}
            onOpenChange={toggle("agent")}
          />
          <AccessHelper mcp={mcp} />
          <ModelHelper
            name="Reply model"
            use="Optional. Without it replies are sorted by rules."
            reading={replyReading(view)}
            placeholder={replyAddress ?? "http://desktop:11434"}
            tried={triedAddresses(view)}
            onFound={setAsked}
            onRecheck={recheck}
            rechecking={setup.isFetching}
          />
          <ModelHelper
            name="Agent model"
            use="Used by the agent worker"
            reading={agentModelReading(view)}
            placeholder={agentOllama ?? "http://desktop:11434"}
            onRecheck={recheck}
            rechecking={setup.isFetching}
          />
        </RowGroup>
      </Section>
      <ConnectedAgents />
    </>
  );
}
