import { API_ROUTES } from "@kickrocks/shared";
import { type ReactNode, useEffect } from "react";
import { useLocation, useNavigate } from "react-router";
import { errorMessage, useApiQuery } from "../../api/index.js";
import {
  Button,
  Callout,
  RowGroup,
  Section,
  Select,
  SkeletonText,
} from "../../components/ui/index.js";
import type { SettingsSection } from "../../lib/paths.js";
import { JurisdictionsCard } from "./JurisdictionsCard.js";
import { LlmCard } from "./LlmCard.js";
import { MailIntakeCard } from "./MailIntakeCard.js";
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

export const SECTION_NAMES: Record<SettingsSection, string> = {
  schedule: "Schedule",
  "site-checks": "Site checks",
  "scan-pace": "Pace",
  sites: "Sites",
  worker: "Workers",
  "mail-intake": "Mail intake",
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

/** A page far longer than a phone screen needs an index: a picker on a phone, a labelled row of links above it. */
function JumpList() {
  const navigate = useNavigate();
  const { hash } = useLocation();
  const entries = Object.entries(SECTION_NAMES);
  return (
    <nav aria-label="On this page" className="mb-4">
      <Select
        aria-label="Jump to a section"
        value={entries.some(([id]) => `#${id}` === hash) ? hash.slice(1) : ""}
        onChange={(event) => navigate({ hash: event.target.value })}
        className="sm:hidden"
      >
        <option value="" disabled>
          Jump to a section
        </option>
        {entries.map(([id, name]) => (
          <option key={id} value={id}>
            {name}
          </option>
        ))}
      </Select>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 max-sm:hidden">
        <span className="font-mono text-caption tracking-[0.04em] text-ink-3 uppercase">
          On this page
        </span>
        {entries.map(([id, name]) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-xs text-meta text-ink-2 underline-offset-2 transition-colors duration-100 hover:text-accent-text hover:underline focus-visible:-outline-offset-2"
          >
            {name}
          </a>
        ))}
      </div>
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
            <Anchor id="mail-intake">
              <MailIntakeCard />
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
