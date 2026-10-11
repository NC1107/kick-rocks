import { API_ROUTES } from "@kickrocks/shared";
import { type ReactNode, useEffect } from "react";
import { useLocation } from "react-router";
import { errorMessage, useApiQuery } from "../../api/index.js";
import { Button, Callout, RowGroup, Section, SkeletonText } from "../../components/ui/index.js";
import type { SettingsSection } from "../../lib/paths.js";
import { JurisdictionsCard } from "./JurisdictionsCard.js";
import { LlmCard } from "./LlmCard.js";
import { PasswordCard } from "./PasswordCard.js";
import { ResetCard } from "./ResetCard.js";
import { RetentionCard } from "./RetentionCard.js";
import { BodyRow, SETTINGS_WIDTH } from "./rows.js";
import { ScanPaceCard } from "./ScanPaceCard.js";
import { ScheduleCard } from "./ScheduleCard.js";
import { SettingsHeader } from "./SettingsHeader.js";
import { SiteChecksCard } from "./SiteChecksCard.js";
import { SitesCard } from "./SitesCard.js";
import { WorkerCard } from "./WorkerCard.js";

const WORKER_POLL_MS = 15_000;

const SECTION_NAMES: Record<SettingsSection, string> = {
  schedule: "Schedule",
  "site-checks": "Site checks",
  "scan-pace": "Pace",
  sites: "Sites",
  worker: "Workers",
  "language-model": "Language model",
  jurisdictions: "Laws",
  retention: "Retention",
  password: "Password",
  reset: "Reset",
};

/** Sections hold their place under the sticky bar and the jump list when a link scrolls to them. */
function Anchor({ id, children }: { id: SettingsSection; children: ReactNode }) {
  return (
    <div id={id} className="scroll-mt-[calc(var(--kr-bar-h)+3.5rem)]">
      {children}
    </div>
  );
}

/** One tap from any section to any other, since the page is far longer than a phone screen. */
function JumpList() {
  return (
    <nav
      aria-label="Jump to a section"
      className="sticky top-(--kr-bar-h) z-10 -mx-(--kr-gutter) mb-4 flex gap-1 overflow-x-auto border-b border-line bg-canvas px-gutter [scrollbar-width:none]"
    >
      {Object.entries(SECTION_NAMES).map(([id, name]) => (
        <a
          key={id}
          href={`#${id}`}
          className="inline-flex min-h-11 shrink-0 items-center rounded-xs px-2 text-meta text-ink-3 transition-colors duration-100 hover:text-ink focus-visible:-outline-offset-2"
        >
          {name}
        </a>
      ))}
    </nav>
  );
}

/** A link to a section lands on it once the sections exist, because the router does not scroll on its own. */
function useScrollToSection(ready: boolean) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || hash === "") return;
    document.getElementById(hash.slice(1))?.scrollIntoView?.({ block: "start" });
  }, [hash, ready]);
}

export function Component() {
  const settings = useApiQuery(API_ROUTES.settingsGet, { refetchInterval: WORKER_POLL_MS });
  useScrollToSection(settings.isSuccess);

  return (
    <>
      <SettingsHeader
        section="General"
        description="Schedule, workers, privacy laws, and password"
      />
      <div className={SETTINGS_WIDTH}>
        {settings.isSuccess ? <JumpList /> : null}
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
            <Anchor id="worker">
              <WorkerCard
                worker={settings.data.worker}
                agent={settings.data.agent}
                now={settings.dataUpdatedAt}
                quietEndHour={settings.data.scanning.quietEndHour}
              />
            </Anchor>
            <Anchor id="language-model">
              <LlmCard llm={settings.data.llm} />
            </Anchor>
            <Anchor id="jurisdictions">
              <JurisdictionsCard />
            </Anchor>
            <Anchor id="retention">
              <RetentionCard retention={settings.data.retention} />
            </Anchor>
            <Anchor id="password">
              <PasswordCard />
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
