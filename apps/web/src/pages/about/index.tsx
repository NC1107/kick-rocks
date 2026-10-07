import { API_ROUTES } from "@kickrocks/shared";
import { StubPage } from "../../components/layout/StubPage.js";

export function Component() {
  return (
    <StubPage
      title="About"
      description="Where the data comes from, and the licenses that apply to it."
      file="src/pages/about/index.tsx"
      mock="mock/about.ts"
      routes={[API_ROUTES.health, API_ROUTES.settingsDataSources]}
    />
  );
}
