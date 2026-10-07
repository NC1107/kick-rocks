import { API_ROUTES } from "@kickrocks/shared";
import { StubPage } from "../../components/layout/StubPage.js";

export function Component() {
  return (
    <StubPage
      title="Targets"
      description="Data brokers and companies you can ask to stop selling your data."
      file="src/pages/targets/index.tsx"
      mock="mock/targets.ts"
      routes={[API_ROUTES.targetsList, API_ROUTES.targetsFacets]}
    />
  );
}
