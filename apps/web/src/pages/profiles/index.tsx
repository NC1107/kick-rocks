import { API_ROUTES } from "@kickrocks/shared";
import { StubPage } from "../../components/layout/StubPage.js";

export function Component() {
  return (
    <StubPage
      title="Profiles"
      description="The people Kick Rocks sends requests for."
      file="src/pages/profiles/index.tsx"
      mock="mock/profiles.ts"
      routes={[API_ROUTES.profilesList, API_ROUTES.profilesDelete]}
    />
  );
}
