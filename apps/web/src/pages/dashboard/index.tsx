import { API_ROUTES } from "@kickrocks/shared";
import { StubPage } from "../../components/layout/StubPage.js";

export function Component() {
  return (
    <StubPage
      title="Dashboard"
      description="Where your requests stand, and what needs you."
      file="src/pages/dashboard/index.tsx"
      mock="mock/dashboard.ts"
      routes={[API_ROUTES.dashboardGet]}
    />
  );
}
