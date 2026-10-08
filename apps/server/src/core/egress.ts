import { type EgressSettings, registrableDomain } from "@kickrocks/shared";

/**
 * The proxy a site is reached through, if the person set one up for it. An empty domain list means
 * every site once a proxy is set. A listed domain matches the site's owner or its own domain, so
 * listing `intelius.com` covers its sister sites too.
 */
export function proxyFor(
  egress: EgressSettings,
  site: { domain: string; ownerKey: string | null },
): string | null {
  if (egress.proxyUrl === null) return null;
  if (egress.domains.length === 0) return egress.proxyUrl;
  const own = registrableDomain(site.domain);
  const covered = egress.domains.some(
    (domain) => domain === site.ownerKey || domain === own || domain === site.domain,
  );
  return covered ? egress.proxyUrl : null;
}
