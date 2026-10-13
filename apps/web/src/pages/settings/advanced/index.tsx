import { API_ROUTES } from "@kickrocks/shared";
import type { ReactNode } from "react";
import { errorMessage, useApiQuery } from "../../../api/index.js";
import { Button, Callout, RowGroup, Section, SkeletonText } from "../../../components/ui/index.js";
import { LlmCard } from "../LlmCard.js";
import { ReplyModelCard } from "../ReplyModelCard.js";
import { ResetCard } from "../ResetCard.js";
import { RetentionCard } from "../RetentionCard.js";
import { RecipesSection } from "../recipes/RecipesSection.js";
import { BodyRow, SETTINGS_WIDTH } from "../rows.js";
import { ScanPaceCard } from "../ScanPaceCard.js";
import { ScheduleCard } from "../ScheduleCard.js";
import { SettingsHeader } from "../SettingsHeader.js";
import { SiteChecksCard } from "../SiteChecksCard.js";
import { SitesCard } from "../SitesCard.js";
import { useScrollToHash } from "../use-scroll-to-hash.js";
import { AgentTuning } from "./AgentTuning.js";
import { UnreviewedSitesCard } from "./UnreviewedSitesCard.js";

/** Sections hold their place under the sticky bar when a link scrolls to them. */
function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-[calc(var(--kr-bar-h)+3.5rem)]">
      {children}
    </div>
  );
}

export function Component() {
  const settings = useApiQuery(API_ROUTES.settingsGet);
  useScrollToHash(settings.isSuccess);

  return (
    <>
      <SettingsHeader section="Advanced" description="Pacing, retention, recipes, and reset" />
      <div className={SETTINGS_WIDTH}>
        {settings.isPending ? (
          <div aria-busy="true">
            <span className="sr-only">Loading settings</span>
            <Section label="Schedule">
              <RowGroup>
                <BodyRow>
                  <SkeletonText lines={5} />
                </BodyRow>
              </RowGroup>
            </Section>
          </div>
        ) : settings.isError ? (
          <Callout
            intent="danger"
            title="Could not load settings"
            action={
              <Button size="sm" onClick={() => settings.refetch()}>
                Try again
              </Button>
            }
          >
            {errorMessage(settings.error)}
          </Callout>
        ) : (
          <div className="flex flex-col gap-4">
            <Anchor id="schedule">
              <ScheduleCard schedule={settings.data.schedule} />
            </Anchor>
            <Anchor id="site-checks">
              <SiteChecksCard siteChecks={settings.data.siteChecks} />
            </Anchor>
            <Anchor id="scan-pace">
              <ScanPaceCard
                scanning={settings.data.scanning}
                egress={settings.data.egress}
                coverage={settings.data.egressCoverage}
              />
            </Anchor>
            <Anchor id="sites">
              <SitesCard />
            </Anchor>
            <Anchor id="retention">
              <RetentionCard retention={settings.data.retention} />
            </Anchor>
            <Anchor id="recipes">
              <RecipesSection />
            </Anchor>
            <Anchor id="agent-worker">
              <UnreviewedSitesCard agent={settings.data.agent} />
            </Anchor>
            <Anchor id="agent-models">
              <AgentTuning />
            </Anchor>
            <Anchor id="reply-model">
              <ReplyModelCard model={settings.data.replyModel} />
            </Anchor>
            <Anchor id="language-model">
              <LlmCard llm={settings.data.llm} />
            </Anchor>
            <Anchor id="reset">
              <ResetCard />
            </Anchor>
          </div>
        )}
      </div>
    </>
  );
}
