import { API_ROUTES, isCoolingDown } from "@kickrocks/shared";
import { useApiQuery } from "../../api/index.js";
import { Row, RowGroup, Section, SkeletonText, Tag } from "../../components/ui/index.js";
import { formatDateTime, formatRelative, pluralize } from "../../lib/format.js";
import { describeCooldown, siteLabel, siteTone } from "../../lib/sites.js";
import { BodyRow, GroupNote } from "./rows.js";

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
          <BodyRow className="text-meta text-ink-3">Could not load the sites just now.</BodyRow>
        ) : cooling.length === 0 ? (
          <BodyRow className="text-meta text-ink-3">
            No site is cooling down. {pluralize(sites.data.visitsLastHour, "visit")} in the last
            hour, out of {sites.data.hourlyCap} allowed.
          </BodyRow>
        ) : (
          cooling.map((site) => (
            <Row
              key={site.domain}
              title={site.domain}
              description={describeCooldown(site)}
              trailingBelowOnPhone
              trailing={
                <>
                  {site.coolingDownUntil ? (
                    <time
                      dateTime={site.coolingDownUntil}
                      title={formatDateTime(site.coolingDownUntil)}
                      className="text-meta text-ink-3"
                    >
                      Until {formatRelative(site.coolingDownUntil)}
                    </time>
                  ) : null}
                  <Tag tone={siteTone(site)}>{siteLabel(site)}</Tag>
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
