import { API_ROUTES } from "@kickrocks/shared";
import { useParams } from "react-router";
import { StubPage } from "../../components/layout/StubPage.js";

export function Component() {
  const params = useParams();
  return (
    <StubPage
      title="Connect a mailbox"
      description="Requests go out from this person's own email account."
      file="src/pages/mailbox/index.tsx"
      mock="mock/mailbox.ts"
      params={params}
      routes={[
        API_ROUTES.mailProviders,
        API_ROUTES.mailboxTest,
        API_ROUTES.mailboxSave,
        API_ROUTES.mailboxFolders,
      ]}
    />
  );
}
