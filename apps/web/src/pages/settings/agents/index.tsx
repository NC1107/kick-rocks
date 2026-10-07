import { API_ROUTES } from "@kickrocks/shared";
import { StubPage } from "../../../components/layout/StubPage.js";

export function Component() {
  return (
    <StubPage
      title="Agents"
      description="Connect Claude Code or another MCP client, and review recipes agents propose."
      file="src/pages/settings/agents/index.tsx"
      mock="mock/settings.ts"
      routes={[API_ROUTES.settingsMcpToken, API_ROUTES.recipesList, API_ROUTES.recipesApprove]}
    />
  );
}
