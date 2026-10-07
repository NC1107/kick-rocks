import { API_ROUTES } from "@kickrocks/shared";
import { StubPage } from "../../../components/layout/StubPage.js";

export function Component() {
  return (
    <StubPage
      title="New profile"
      description="Add a person and the details brokers know them by."
      file="src/pages/profiles/new/index.tsx"
      mock="mock/profiles.ts"
      routes={[API_ROUTES.profilesCreate]}
    />
  );
}
