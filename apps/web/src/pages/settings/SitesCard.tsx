import { API_ROUTES, isCoolingDown } from "@kickrocks/shared";
import { useApiQuery } from "../../api/index.js";
import {
  RelativeTime,
  Row,
  RowGroup,
  Section,
  SiteMark,
  SkeletonText,
} from "../../components/ui/index.js";
import { pluralize } from "../../lib/format.js";
import { describeCooldown } from "../../lib/sites.js";
import { BodyRow, GroupNote, Value } from "./rows.js";

const POLL_MS = 30_000;

/** The sites Kick Rocks is leaving alone right now, and why. Quiet when there are none. */
export function SitesCard() {
  const sites = useApiQuery(API_ROUTES.settingsSites, { refetchInterval: POLL_MS });
  const cooling = sites.data?.items.filter(isCoolingDown) ?? [];

  return (
    <Section label="Sites cooling down">
      <RowGroup>
        {sites.isPending ? (
          <BodyRow>
            <SkeletonText lines={2} />
          </BodyRow>
        ) : sites.isError ? (
          <BodyRow className="text-ui text-ink-2">Could not load the sites just now.</BodyRow>
        ) : cooling.length === 0 ? (
          <BodyRow className="text-ui text-ink-2">
            No site is cooling down. {pluralize(sites.data.visitsLastHour, "visit")} in the last
            hour, out of {sites.data.hourlyCap} allowed.
          </BodyRow>
        ) : (
          cooling.map((site) => (
            <Row
              key={site.domain}
              title={<span className="font-mono">{site.domain}</span>}
              description={describeCooldown(site)}
              trailingBelowOnPhone
              trailing={
                <>
                  {site.coolingDownUntil ? (
                    <span className="text-meta text-ink-3">
                      Resumes{" "}
                      <Value className="text-ink-3">
                        <RelativeTime iso={site.coolingDownUntil} />
                      </Value>
                    </span>
                  ) : null}
                  <SiteMark site={site} />
                </>
              }
            />
          ))
        )}
      </RowGroup>
      <GroupNote>
        When a site answers with a rate limit, a bot check, or a CAPTCHA, Kick Rocks leaves it alone
        for longer each time and tries a single careful visit before it resumes.
      </GroupNote>
    </Section>
  );
}
