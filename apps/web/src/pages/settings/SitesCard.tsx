import { API_ROUTES, isCoolingDown } from "@kickrocks/shared";
import { useApiQuery } from "../../api/index.js";
import { Badge, Card, CardHeader, SkeletonText } from "../../components/ui/index.js";
import { formatDateTime, formatRelative, pluralize } from "../../lib/format.js";
import { describeCooldown, siteLabel, siteTone } from "../../lib/sites.js";

const POLL_MS = 30_000;

/** The sites Kick Rocks is leaving alone right now, and why. Quiet when there are none. */
export function SitesCard() {
  const sites = useApiQuery(API_ROUTES.settingsSites, { refetchInterval: POLL_MS });
  const cooling = sites.data?.items.filter(isCoolingDown) ?? [];

  return (
    <Card>
      <CardHeader
        title="Sites cooling down"
        description="When a site answers with a rate limit, a bot check, or a CAPTCHA, Kick Rocks leaves it alone for longer each time and tries a single careful visit before it resumes."
      />
      {sites.isPending ? (
        <SkeletonText lines={2} />
      ) : sites.isError ? (
        <p className="text-base text-ink-muted">Could not load the sites just now.</p>
      ) : cooling.length === 0 ? (
        <p className="text-base text-ink-muted">
          No site is cooling down. {pluralize(sites.data.visitsLastHour, "visit")} in the last hour,
          out of {sites.data.hourlyCap} allowed.
        </p>
      ) : (
        <ul className="m-0 flex list-none flex-col divide-y divide-line p-0">
          {cooling.map((site) => (
            <li
              key={site.domain}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5 first:pt-0 last:pb-0"
            >
              <div className="min-w-0">
                <p className="break-words text-base font-medium text-ink">{site.domain}</p>
                <p className="text-sm text-ink-muted">{describeCooldown(site)}</p>
              </div>
              <div className="flex items-center gap-2">
                {site.coolingDownUntil ? (
                  <time
                    dateTime={site.coolingDownUntil}
                    title={formatDateTime(site.coolingDownUntil)}
                    className="text-sm text-ink-muted"
                  >
                    Until {formatRelative(site.coolingDownUntil)}
                  </time>
                ) : null}
                <Badge tone={siteTone(site)}>{siteLabel(site)}</Badge>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
