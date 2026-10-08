import { API_ROUTES } from "@kickrocks/shared";
import { useApiQuery } from "../../../api/index.js";
import { Row, RowGroup, Section, SkeletonText, Tag } from "../../../components/ui/index.js";
import { formatDateTime, formatRelative } from "../../../lib/format.js";
import { PUSHBACK_LABELS, siteLabel, siteTone } from "../../../lib/sites.js";

/** How Kick Rocks has been treating this site and how the site has answered. */
export function SiteVisits({ targetId }: { targetId: string }) {
  const query = useApiQuery(API_ROUTES.targetsSite, { params: { id: targetId } });
  const site = query.data?.site ?? null;

  return (
    <Section label="Visits">
      {query.isPending ? (
        <SkeletonText lines={3} />
      ) : query.isError ? (
        <p className="text-meta text-ink-3">Could not load the visit history just now.</p>
      ) : site === null ? (
        <p className="text-meta text-ink-3">
          Nothing has visited this site yet, so there is no history to show.
        </p>
      ) : (
        <RowGroup>
          <Row title="Visits today" trailing={`${site.visitsToday} of ${site.dailyCap}`} />
          <Row title="Status" trailing={<Tag tone={siteTone(site)}>{siteLabel(site)}</Tag>} />
          <Row
            title="Last pushback"
            trailing={
              site.lastPushbackAt && site.lastPushbackKind ? (
                <time dateTime={site.lastPushbackAt} title={formatDateTime(site.lastPushbackAt)}>
                  {PUSHBACK_LABELS[site.lastPushbackKind]}, {formatRelative(site.lastPushbackAt)}
                </time>
              ) : (
                "None"
              )
            }
          />
          {site.coolingDownUntil ? (
            <Row
              title="Cooling down until"
              trailing={
                <time
                  dateTime={site.coolingDownUntil}
                  title={formatDateTime(site.coolingDownUntil)}
                >
                  {formatRelative(site.coolingDownUntil)}
                </time>
              }
            />
          ) : null}
        </RowGroup>
      )}
    </Section>
  );
}
