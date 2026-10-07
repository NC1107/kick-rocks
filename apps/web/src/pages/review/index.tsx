import { API_ROUTES } from "@kickrocks/shared";
import { StubPage } from "../../components/layout/StubPage.js";

export function Component() {
  return (
    <StubPage
      title="Review"
      description="Blocked tasks, records to confirm, mail nobody could classify, and scans."
      file="src/pages/review/index.tsx"
      mock="mock/review.ts"
      routes={[
        API_ROUTES.reviewQueue,
        API_ROUTES.taskResume,
        API_ROUTES.taskMarkDone,
        API_ROUTES.taskHandOff,
        API_ROUTES.taskRetry,
        API_ROUTES.matchDecide,
        API_ROUTES.messageGet,
        API_ROUTES.messageClassify,
        // Scans are started and listed here, because their results are the matches below.
        API_ROUTES.scansStart,
        API_ROUTES.scansList,
      ]}
    />
  );
}
