import { API_ROUTES } from "@kickrocks/shared";
import { StubPage } from "../../components/layout/StubPage.js";

export function Component() {
  return (
    <StubPage
      title="Settings"
      description="Schedule, language model, and worker."
      file="src/pages/settings/index.tsx"
      mock="mock/settings.ts"
      routes={[API_ROUTES.settingsGet, API_ROUTES.settingsPatch]}
    />
  );
}
