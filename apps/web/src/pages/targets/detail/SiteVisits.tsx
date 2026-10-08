import { API_ROUTES } from "@kickrocks/shared";
import { useApiQuery } from "../../../api/index.js";
import {
  DescriptionList,
  RelativeTime,
  Section,
  SiteMark,
  SkeletonText,
} from "../../../components/ui/index.js";
import { PUSHBACK_LABELS } from "../../../lib/sites.js";

const MONO = "font-mono tabular-nums";

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
        <div className="rounded-md border border-line bg-surface px-3.5 py-3">
          <DescriptionList
            items={[
              {
                term: "Visits today",
                description: (
                  <span className={MONO}>{`${site.visitsToday} of ${site.dailyCap}`}</span>
                ),
              },
              { term: "Status", description: <SiteMark site={site} /> },
              {
                term: "Last pushback",
                description:
                  site.lastPushbackAt && site.lastPushbackKind ? (
                    <>
                      {PUSHBACK_LABELS[site.lastPushbackKind]},{" "}
                      <span className={MONO}>
                        <RelativeTime iso={site.lastPushbackAt} />
                      </span>
                    </>
                  ) : (
                    "-"
                  ),
              },
              ...(site.coolingDownUntil
                ? [
                    {
                      term: "Resumes",
                      description: (
                        <span className={MONO}>
                          <RelativeTime iso={site.coolingDownUntil} />
                        </span>
                      ),
                    },
                  ]
                : []),
            ]}
          />
        </div>
      )}
    </Section>
  );
}
