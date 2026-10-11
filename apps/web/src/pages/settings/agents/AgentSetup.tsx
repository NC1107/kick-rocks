import type { AgentSetupView, SettingsView } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage } from "../../../api/index.js";
import { Button, Callout, RowGroup, Section, SkeletonText } from "../../../components/ui/index.js";
import { readStorage, STORAGE_KEYS, writeStorage } from "../../../lib/storage.js";
import { BodyRow } from "../rows.js";
import { Advanced } from "./Advanced.js";
import { Detection } from "./Detection.js";
import { AddressQuestion, GpuAnswer, GpuQuestion, RecommendationCard } from "./Recommendation.js";

export function SetupSkeleton() {
  return (
    <Section label="Setup">
      <RowGroup aria-busy="true">
        <BodyRow>
          <span className="sr-only">Looking for Ollama and the agent worker</span>
          <SkeletonText lines={4} />
        </BodyRow>
      </RowGroup>
    </Section>
  );
}

export function SetupError({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Callout
      intent="danger"
      title="Could not check the setup"
      action={
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      }
    >
      {errorMessage(error)}
    </Callout>
  );
}

function storedOpen(): boolean {
  return readStorage(STORAGE_KEYS.agentsAdvancedOpen) === "1";
}

/** Whether Advanced is open, remembered across visits. */
export function useAdvancedOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(storedOpen);
  return [
    open,
    (next) => {
      setOpen(next);
      writeStorage(STORAGE_KEYS.agentsAdvancedOpen, next ? "1" : "0");
    },
  ];
}

/**
 * The page's main part: what was found, the one setup recommended from it, the few things that
 * could not be found out and are asked once, and everything else behind Advanced.
 */
export function AgentSetup({
  view,
  settings,
  onFound,
  onRecheck,
  rechecking,
}: {
  view: AgentSetupView;
  settings: SettingsView;
  onFound: (baseUrl: string) => void;
  onRecheck: () => void;
  rechecking: boolean;
}) {
  const [advancedOpen, changeAdvanced] = useAdvancedOpen();
  const { recommendation, missing } = view;
  const hosted = (view.components.worker?.status.model?.provider ?? "ollama") !== "ollama";

  const openGate = () => {
    changeAdvanced(true);
    requestAnimationFrame(() =>
      document.getElementById("safety-gate")?.scrollIntoView({ block: "start" }),
    );
  };

  const hasCard =
    recommendation.agent !== null ||
    recommendation.reply !== null ||
    recommendation.pull !== null ||
    recommendation.reasons.agent !== null ||
    hosted;

  return (
    <>
      <Section label="Setup">
        <Detection view={view} />
      </Section>
      {hasCard ? (
        <RecommendationCard view={view} settings={settings} onOpenGate={openGate} />
      ) : null}
      {missing.includes("gpuMemory") && !hosted ? <GpuQuestion view={view} /> : null}
      {hosted ? null : <GpuAnswer view={view} />}
      {missing.includes("ollama") ? (
        <AddressQuestion onFound={onFound} tried={view.components.server.endpoints} />
      ) : null}
      <Advanced
        view={view}
        settings={settings}
        open={advancedOpen}
        onOpenChange={changeAdvanced}
        onRecheck={onRecheck}
        rechecking={rechecking}
      />
    </>
  );
}
