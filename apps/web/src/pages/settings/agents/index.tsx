import { API_ROUTES } from "@kickrocks/shared";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import { Button, Callout, RowGroup, Section, SkeletonText } from "../../../components/ui/index.js";
import { BodyRow, SETTINGS_WIDTH } from "../rows.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { McpCard } from "./McpCard.js";
import { ModelPresets } from "./ModelPresets.js";
import { ProposedRecipes } from "./ProposedRecipes.js";

export function Component() {
  const settings = useApiQuery(API_ROUTES.settingsGet);

  return (
    <>
      <SettingsHeader description="Local models, MCP clients, and recipes" />
      <div className={`${SETTINGS_WIDTH} flex flex-col gap-4`}>
        {settings.isPending ? (
          <Section label="Agent access">
            <RowGroup aria-busy="true">
              <BodyRow>
                <span className="sr-only">Loading agent settings</span>
                <SkeletonText lines={4} />
              </BodyRow>
            </RowGroup>
          </Section>
        ) : settings.isError ? (
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
        ) : (
          <>
            <ModelPresets settings={settings.data} />
            <McpCard mcp={settings.data.mcp} />
          </>
        )}
        <ProposedRecipes />
      </div>
    </>
  );
}
