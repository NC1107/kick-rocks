import { API_ROUTES } from "@kickrocks/shared";
import { StubPage } from "../../components/layout/StubPage.js";

export function Component() {
  return (
    <StubPage
      title="Requests"
      description="Every request, its status, and when an answer is due."
      file="src/pages/requests/index.tsx"
      mock="mock/requests.ts"
      routes={[API_ROUTES.requestsList]}
    />
  );
}
