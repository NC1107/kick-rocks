import { API_ROUTES } from "@kickrocks/shared";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import { Alert, Button, Card, SkeletonText } from "../../../components/ui/index.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { McpCard } from "./McpCard.js";
import { ProposedRecipes } from "./ProposedRecipes.js";

export function Component() {
  const settings = useApiQuery(API_ROUTES.settingsGet);

  return (
    <>
      <SettingsHeader description="Connect Claude Code or another MCP client, and review recipes agents propose." />
      <div className="flex flex-col gap-6">
        {settings.isPending ? (
          <Card aria-busy="true">
            <span className="sr-only">Loading agent settings</span>
            <SkeletonText lines={5} />
          </Card>
        ) : settings.isError ? (
          <Alert
            intent="danger"
            title="Could not load agent settings"
            action={
              <Button size="sm" onClick={() => settings.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(settings.error)}
          </Alert>
        ) : (
          <McpCard mcp={settings.data.mcp} />
        )}
        <ProposedRecipes />
      </div>
    </>
  );
}
