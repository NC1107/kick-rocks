import { API_ROUTES } from "@kickrocks/shared";
import { useParams } from "react-router";
import { StubPage } from "../../../components/layout/StubPage.js";

export function Component() {
  const params = useParams();
  return (
    <StubPage
      title="Request"
      description="The timeline, replies, and tasks for one request."
      file="src/pages/requests/detail/index.tsx"
      mock="mock/requests.ts"
      params={params}
      routes={[API_ROUTES.requestsGet, API_ROUTES.requestsAct]}
    />
  );
}
