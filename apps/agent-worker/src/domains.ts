import { isOnDomain, type TargetSummary } from "@kickrocks/shared";

function bareHost(host: string): string {
  return host.toLowerCase().replace(/^www\./, "");
}

function hostOf(url: string | null | undefined): string | null {
  if (url === null || url === undefined) return null;
  try {
    return bareHost(new URL(url).hostname);
  } catch {
    return null;
  }
}

/**
 * One part of a shared host, such as a single Google Form or one company's privacy portal. A
 * whole host like docs.google.com serves everyone's forms, so trusting it would let a page send
 * the model to a form that belongs to someone else.
 */
export interface PageScope {
  host: string;
  /** A path ending in "/" covers everything under it; any other path covers itself and its subpaths. */
  path: string;
}

export interface AllowedSites {
  /** Hosts trusted whole, with their subdomains: the target's own. */
  domains: string[];
  /** Exact hosts trusted for one path prefix only. */
  pages: PageScope[];
}

/** The folder a page lives in, so a form's own pages are covered but its neighbours are not. */
export function scopeOf(url: string): PageScope | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const folder = parsed.pathname.slice(0, parsed.pathname.lastIndexOf("/") + 1);
  return { host: bareHost(parsed.hostname), path: folder === "/" ? parsed.pathname : folder };
}

function pathWithin(pathname: string, prefix: string): boolean {
  if (prefix.endsWith("/")) return pathname.startsWith(prefix);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

/**
 * The hosts and pages an agent may visit for a target. The target's domain and website are trusted
 * as a whole. A start page on any other host, which is usually a shared form platform, is trusted
 * for its own path only.
 */
export function allowedSitesFor(
  target: TargetSummary,
  extraUrls: (string | null | undefined)[] = [],
): AllowedSites {
  const domain = bareHost(target.domain);
  const trusted = [domain, hostOf(target.website)];
  const domains = [
    ...new Set(trusted.filter((host): host is string => host !== null && host !== "")),
  ];
  const pages: PageScope[] = [];
  for (const url of [target.optOutUrl, target.searchUrl, ...extraUrls]) {
    if (url === null || url === undefined || domains.some((host) => isOnDomain(url, host))) {
      continue;
    }
    const scope = scopeOf(url);
    if (scope && !pages.some((page) => page.host === scope.host && page.path === scope.path)) {
      pages.push(scope);
    }
  }
  return { domains, pages };
}

export interface NavigationPolicy {
  domains: readonly string[];
  pages: readonly PageScope[];
  allowHttp: boolean;
}

/** Whether a web address is on a trusted domain or inside a trusted page scope. */
export function withinSites(
  url: string,
  sites: Pick<NavigationPolicy, "domains" | "pages">,
): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (sites.domains.some((domain) => isOnDomain(url, domain))) return true;
  const host = bareHost(parsed.hostname);
  return sites.pages.some((page) => page.host === host && pathWithin(parsed.pathname, page.path));
}

export function describeSites(sites: Pick<NavigationPolicy, "domains" | "pages">): string {
  return [
    ...sites.domains,
    ...sites.pages.map((page) => `${page.host}${page.path}${page.path.endsWith("/") ? "*" : ""}`),
  ].join(", ");
}

/** Why a URL may not be opened, or null when it may. The reason is shown to the model. */
export function refuseNavigation(url: string, policy: NavigationPolicy): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return "That is not a valid URL";
  }
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && policy.allowHttp)) {
    return parsed.protocol === "http:"
      ? "Only https pages may be opened"
      : `A ${parsed.protocol.replace(":", "")} address cannot be opened`;
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return "Addresses with a login in them are not allowed";
  }
  if (!withinSites(url, policy)) {
    return `${parsed.hostname}${parsed.pathname} is not one of this target's domains or pages (${describeSites(policy)})`;
  }
  return null;
}
