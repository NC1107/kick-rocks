import { API_ROUTES } from "@kickrocks/shared";
import { useParams } from "react-router";
import { StubPage } from "../../../components/layout/StubPage.js";

export function Component() {
  const params = useParams();
  return (
    <StubPage
      title="Profile"
      description="Names, emails, addresses, and the mailbox for one person."
      file="src/pages/profiles/detail/index.tsx"
      mock="mock/profiles.ts"
      params={params}
      routes={[
        API_ROUTES.profilesGet,
        API_ROUTES.profilesUpdate,
        API_ROUTES.profilesReplaceIdentities,
      ]}
    />
  );
}
