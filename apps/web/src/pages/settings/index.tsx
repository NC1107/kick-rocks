import { API_ROUTES } from "@kickrocks/shared";
import { StubPage } from "../../components/layout/StubPage.js";

export function Component() {
  return (
    <StubPage
      title="Settings"
      description="Schedule, language model, worker, jurisdictions, and the password."
      file="src/pages/settings/index.tsx"
      mock="mock/settings.ts"
      routes={[
        API_ROUTES.settingsGet,
        API_ROUTES.settingsPatch,
        // Jurisdictions and changing the password live here, even though the password route is auth's.
        API_ROUTES.settingsJurisdictions,
        API_ROUTES.authPassword,
      ]}
    />
  );
}
