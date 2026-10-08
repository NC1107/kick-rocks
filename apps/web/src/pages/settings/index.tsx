import { API_ROUTES } from "@kickrocks/shared";
import { errorMessage, useApiQuery } from "../../api/index.js";
import { Alert, Button, Card, SkeletonText } from "../../components/ui/index.js";
import { JurisdictionsCard } from "./JurisdictionsCard.js";
import { LlmCard } from "./LlmCard.js";
import { PasswordCard } from "./PasswordCard.js";
import { ResetCard } from "./ResetCard.js";
import { RetentionCard } from "./RetentionCard.js";
import { ScanPaceCard } from "./ScanPaceCard.js";
import { ScheduleCard } from "./ScheduleCard.js";
import { SettingsHeader } from "./SettingsHeader.js";
import { SiteChecksCard } from "./SiteChecksCard.js";
import { SitesCard } from "./SitesCard.js";
import { WorkerCard } from "./WorkerCard.js";

const WORKER_POLL_MS = 15_000;

export function Component() {
  const settings = useApiQuery(API_ROUTES.settingsGet, { refetchInterval: WORKER_POLL_MS });

  return (
    <>
      <SettingsHeader description="Schedule, workers, language model, privacy laws, retention, and the password." />
      {settings.isPending ? (
        <div aria-busy="true" className="flex flex-col gap-5">
          <span className="sr-only">Loading settings</span>
          {[0, 1, 2].map((key) => (
            <Card key={key}>
              <SkeletonText lines={4} />
            </Card>
          ))}
        </div>
      ) : settings.isError ? (
        <Alert
          intent="danger"
          title="Could not load settings"
          action={
            <Button size="sm" onClick={() => settings.refetch()}>
              Try again
            </Button>
          }
        >
          {errorMessage(settings.error)}
        </Alert>
      ) : (
        <div className="flex flex-col gap-5">
          <ScheduleCard schedule={settings.data.schedule} />
          <SiteChecksCard siteChecks={settings.data.siteChecks} />
          <ScanPaceCard
            scanning={settings.data.scanning}
            egress={settings.data.egress}
            coverage={settings.data.egressCoverage}
          />
          <SitesCard />
          <WorkerCard
            worker={settings.data.worker}
            agent={settings.data.agent}
            now={settings.dataUpdatedAt}
          />
          <LlmCard llm={settings.data.llm} />
          <JurisdictionsCard />
          <RetentionCard retention={settings.data.retention} />
          <PasswordCard />
          <ResetCard />
        </div>
      )}
    </>
  );
}
