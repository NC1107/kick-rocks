import type { ListingSite } from "@kickrocks/shared";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { Button, TextLink } from "../../components/ui/index.js";
import { paths } from "../../lib/paths.js";
import { ListingLine, ScanTimes } from "./ListingLine.js";
import { SiteMenu } from "./SiteMenu.js";

/** A removal is where a site with records leads; a site without one leads to its own page. */
function destination(site: ListingSite): string {
  const request = site.records.find((record) => record.request)?.request;
  return request ? paths.request(request.id) : paths.target(site.targetId);
}

/** A stuck site gets the one thing that unsticks it in place of the menu. */
function stuckAction(site: ListingSite, onScan: (site: ListingSite) => void): ReactNode {
  if (site.status === "removal_stalled") {
    const request = site.records.find((record) => record.request)?.request;
    return request ? <TextLink to={paths.request(request.id)}>Send a follow-up</TextLink> : null;
  }
  if (site.status === "failed") {
    return (
      <Button variant="ghost" size="sm" onClick={() => onScan(site)}>
        Scan again
      </Button>
    );
  }
  return null;
}

/** One row per site. A stretched link makes the whole row open its request or site without nesting links. */
export function SiteRows({
  sites,
  profileId,
  label,
  onScan,
}: {
  sites: readonly ListingSite[];
  profileId: string;
  label: string;
  onScan: (site: ListingSite) => void;
}) {
  return (
    <ul
      aria-label={label}
      className="m-0 min-w-0 list-none divide-y divide-line overflow-hidden rounded-md border border-line bg-surface p-0"
    >
      {sites.map((site) => (
        <li key={site.targetId} className="relative flex items-center pr-1.5 hover:bg-hover">
          <Link
            to={destination(site)}
            aria-label={`Open ${site.targetName}`}
            className="absolute inset-0 focus-visible:-outline-offset-2"
          />
          <div className="pointer-events-none relative grid min-h-11 min-w-0 flex-1 items-center gap-x-4 gap-y-0.5 py-2 pl-3.5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] [&_a]:pointer-events-auto">
            <span className="min-w-0">
              <span className="block truncate text-ui font-semibold text-ink">
                {site.targetName}
              </span>
              <span className="block truncate font-mono text-caption text-ink-3">
                {site.domain}
              </span>
            </span>
            <ListingLine site={site} profileId={profileId} verified />
            <span className="sm:text-right">
              <ScanTimes site={site} hideDue={site.status === "removal_stalled"} />
            </span>
          </div>
          <div className="relative pr-2">
            {stuckAction(site, onScan) ?? (
              <SiteMenu site={site} profileId={profileId} onScan={() => onScan(site)} />
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}
