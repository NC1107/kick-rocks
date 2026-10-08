import { API_ROUTES } from "@kickrocks/shared";
import { useApiQuery } from "../../../api/index.js";
import {
  RelativeTime,
  RowGroup,
  Section,
  SiteMark,
  SkeletonText,
} from "../../../components/ui/index.js";
import { PUSHBACK_LABELS } from "../../../lib/sites.js";
import { FactRow } from "../../settings/rows.js";

/** How Kick Rocks has been treating this site and how the site has answered. */
export function SiteVisits({ targetId }: { targetId: string }) {
  const query = useApiQuery(API_ROUTES.targetsSite, { params: { id: targetId } });
  const site = query.data?.site ?? null;

  return (
    <Section label="Visits">
      {query.isPending ? (
        <SkeletonText lines={3} />
      ) : query.isError ? (
        <p className="text-ui text-ink-2">Could not load the visit history just now.</p>
      ) : site === null ? (
        <p className="text-ui text-ink-2">
          Nothing has visited this site yet, so there is no history to show.
        </p>
      ) : (
        <RowGroup>
          <FactRow label="Visits today">{`${site.visitsToday} of ${site.dailyCap}`}</FactRow>
          <FactRow label="Status" mono={false}>
            <SiteMark site={site} />
          </FactRow>
          <FactRow label="Last pushback">
            {site.lastPushbackAt && site.lastPushbackKind ? (
              <>
                {PUSHBACK_LABELS[site.lastPushbackKind]}, <RelativeTime iso={site.lastPushbackAt} />
              </>
            ) : (
              "-"
            )}
          </FactRow>
          {site.coolingDownUntil ? (
            <FactRow label="Resumes">
              <RelativeTime iso={site.coolingDownUntil} />
            </FactRow>
          ) : null}
        </RowGroup>
      )}
    </Section>
  );
}
