import { API_ROUTES } from "@kickrocks/shared";
import { useState } from "react";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import { Button, Callout } from "../../../components/ui/index.js";
import { SETTINGS_WIDTH } from "../rows.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { AdvancedGate } from "./Advanced.js";
import { AgentAccess } from "./AgentAccess.js";
import { AgentSetup, SetupError, SetupSkeleton, useAdvancedOpen } from "./AgentSetup.js";
import { ConnectedAgents } from "./ConnectedAgents.js";
import { ProposedRecipes } from "./ProposedRecipes.js";

export function Component() {
  const settings = useApiQuery(API_ROUTES.settingsGet);
  const [advancedOpen, setAdvancedOpen] = useAdvancedOpen();
  // An address the person typed, probed first and kept for this visit until Apply saves it.
  const [asked, setAsked] = useState<string | null>(null);
  const setup = useApiQuery(API_ROUTES.settingsAgentSetup, {
    query: asked ? { ask: asked } : {},
  });

  return (
    <>
      <SettingsHeader section="Agents" description="Models, access, and recipes" />
      <div className={`${SETTINGS_WIDTH} flex flex-col gap-4`}>
        {settings.isError ? (
          <Callout
            intent="danger"
            title="Could not load agent settings"
            action={
              <Button size="sm" onClick={() => settings.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(settings.error)}
          </Callout>
        ) : settings.isPending ? (
          <SetupSkeleton />
        ) : (
          <>
            {setup.isError ? (
              <SetupError error={setup.error} onRetry={() => setup.refetch()} />
            ) : setup.isPending ? (
              <SetupSkeleton />
            ) : (
              <AgentSetup
                view={setup.data}
                settings={settings.data}
                onFound={setAsked}
                onRecheck={() => setup.refetch()}
                rechecking={setup.isFetching}
              />
            )}
            <ConnectedAgents />
            <AgentAccess mcp={settings.data.mcp} />
            {setup.isSuccess ? null : (
              <AdvancedGate
                settings={settings.data}
                open={advancedOpen}
                onOpenChange={setAdvancedOpen}
              />
            )}
          </>
        )}
        <ProposedRecipes />
      </div>
    </>
  );
}
