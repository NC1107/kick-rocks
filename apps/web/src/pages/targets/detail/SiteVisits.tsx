import { API_ROUTES } from "@kickrocks/shared";
import { useApiQuery } from "../../../api/index.js";
import {
  Badge,
  Card,
  CardHeader,
  DescriptionList,
  SkeletonText,
} from "../../../components/ui/index.js";
import { formatDateTime, formatRelative } from "../../../lib/format.js";
import { PUSHBACK_LABELS, siteLabel, siteTone } from "../../../lib/sites.js";

/** How Kick Rocks has been treating this site and how the site has answered. */
export function SiteVisits({ targetId }: { targetId: string }) {
  const query = useApiQuery(API_ROUTES.targetsSite, { params: { id: targetId } });

  return (
    <Card>
      <CardHeader
        title="Visits"
        description="Kick Rocks spaces its visits and backs off when a site pushes back."
      />
      {query.isPending ? (
        <SkeletonText lines={3} />
      ) : query.isError ? (
        <p className="text-base text-ink-muted">Could not load the visit history just now.</p>
      ) : query.data.site === null ? (
        <p className="text-base text-ink-muted">
          Nothing has visited this site yet, so there is no history to show.
        </p>
      ) : (
        <DescriptionList
          items={[
            {
              term: "Visits today",
              description: `${query.data.site.visitsToday} of ${query.data.site.dailyCap}`,
            },
            {
              term: "Status",
              description: (
                <Badge tone={siteTone(query.data.site)}>{siteLabel(query.data.site)}</Badge>
              ),
            },
            {
              term: "Last pushback",
              description:
                query.data.site.lastPushbackAt && query.data.site.lastPushbackKind ? (
                  <time
                    dateTime={query.data.site.lastPushbackAt}
                    title={formatDateTime(query.data.site.lastPushbackAt)}
                  >
                    {PUSHBACK_LABELS[query.data.site.lastPushbackKind]},{" "}
                    {formatRelative(query.data.site.lastPushbackAt)}
                  </time>
                ) : (
                  "None"
                ),
            },
            ...(query.data.site.coolingDownUntil
              ? [
                  {
                    term: "Cooling down until",
                    description: (
                      <time
                        dateTime={query.data.site.coolingDownUntil}
                        title={formatDateTime(query.data.site.coolingDownUntil)}
                      >
                        {formatRelative(query.data.site.coolingDownUntil)}
                      </time>
                    ),
                  },
                ]
              : []),
          ]}
        />
      )}
    </Card>
  );
}
