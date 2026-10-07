import { API_ROUTES } from "@kickrocks/shared";
import { StubPage } from "../../../components/layout/StubPage.js";

export function Component() {
  return (
    <StubPage
      title="New campaign"
      description="Choose who to ask and what to ask for, then preview the email."
      file="src/pages/campaigns/new/index.tsx"
      mock="mock/campaigns.ts"
      routes={[API_ROUTES.campaignsPreview, API_ROUTES.campaignsCreate]}
    />
  );
}
