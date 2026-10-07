import { API_ROUTES } from "@kickrocks/shared";
import { StubPage } from "../../components/layout/StubPage.js";

export function Component() {
  return (
    <StubPage
      title="Review"
      description="Blocked tasks, records to confirm, and mail nobody could classify."
      file="src/pages/review/index.tsx"
      mock="mock/review.ts"
      routes={[
        API_ROUTES.reviewQueue,
        API_ROUTES.taskResume,
        API_ROUTES.matchDecide,
        API_ROUTES.messageClassify,
      ]}
    />
  );
}
