import { API_ROUTES } from "@kickrocks/shared";
import { useParams } from "react-router";
import { StubPage } from "../../../components/layout/StubPage.js";

export function Component() {
  const params = useParams();
  return (
    <StubPage
      title="Target"
      description="How to reach one broker or company, and what automation exists for it."
      file="src/pages/targets/detail/index.tsx"
      mock="mock/targets.ts"
      params={params}
      routes={[API_ROUTES.targetsGet]}
    />
  );
}
