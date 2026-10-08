import { type KickRocksDb, targets } from "@kickrocks/db";
import { registrableDomain } from "@kickrocks/shared";
import type { AppServices } from "../services.js";
import { ownerKeyOfRow } from "./site-politeness.js";

type EgressServices = Pick<AppServices, "db" | "settings" | "politeness">;

interface OwnedSite {
  domain: string;
  ownerKey: string;
}

function loadSites(db: KickRocksDb): OwnedSite[] {
  return db
    .select({ domain: targets.domain, data: targets.data })
    .from(targets)
    .all()
    .map((row) => ({ domain: row.domain, ownerKey: ownerKeyOfRow(row) }));
}

/**
 * The owner keys a listed domain stands for: its own, and the key of every target that sits on
 * it. Listing `intelius.com` therefore covers `truthfinder.com`, which shares its operator.
 */
function keysOfListed(listed: string, sites: readonly OwnedSite[]): Set<string> {
  const own = registrableDomain(listed);
  const keys = new Set([listed]);
  for (const site of sites) {
    if (site.domain === listed || registrableDomain(site.domain) === own) keys.add(site.ownerKey);
  }
  return keys;
}

export interface EgressRouter {
  /**
   * The proxy a site is reached through, if the person set one up for it. An empty domain list
   * means every site once a proxy is set. A listed domain matches the site's own domain, and every
   * site of the same operator.
   */
  proxyFor(site: { domain: string; ownerKey: string | null }): string | null;
  /** The other sites a listed domain also routes, for the Settings list. */
  sistersOf(listed: string): string[];
}

/**
 * Reads the target list only when a proxy is set for named sites, so a plain install pays nothing
 * for routing it does not use.
 */
export function createEgressRouter(services: EgressServices): EgressRouter {
  const egress = services.settings.get("egress");
  let sites: OwnedSite[] | null = null;
  const allSites = () => {
    sites ??= loadSites(services.db);
    return sites;
  };

  return {
    proxyFor(site) {
      if (egress.proxyUrl === null) return null;
      if (egress.domains.length === 0) return egress.proxyUrl;
      const own = registrableDomain(site.domain);
      const covered = egress.domains.some(
        (listed) =>
          listed === site.ownerKey ||
          listed === own ||
          listed === site.domain ||
          (site.ownerKey !== null && keysOfListed(listed, allSites()).has(site.ownerKey)),
      );
      return covered ? egress.proxyUrl : null;
    },
    sistersOf(listed) {
      const keys = keysOfListed(listed, allSites());
      const own = registrableDomain(listed);
      return allSites()
        .filter((site) => keys.has(site.ownerKey) && registrableDomain(site.domain) !== own)
        .map((site) => site.domain)
        .sort();
    },
  };
}

/** The proxy for one target, by id. */
export function proxyForTarget(
  services: EgressServices,
  target: { id: string; domain: string },
  router: EgressRouter = createEgressRouter(services),
): string | null {
  return router.proxyFor({
    domain: target.domain,
    ownerKey: services.politeness.domainOf(target.id),
  });
}
