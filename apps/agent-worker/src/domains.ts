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
  /** Parameters an address must carry with these exact values, when they are what names the tenant. */
  query?: [name: string, value: string][];
  /**
   * A route fragment an address must start with, for single-page portals that put the tenant in
   * it. It runs through the tenant's own segment and no further, so moving around the portal's
   * routes stays inside it.
   */
  fragment?: string;
}

export interface AllowedSites {
  /** Hosts trusted whole, with their subdomains: the target's own. */
  domains: string[];
  /** Exact hosts trusted for one path prefix only. */
  pages: PageScope[];
}

/** Parameters that tell a visitor's source or view apart, never a tenant. */
const NON_IDENTIFYING_PARAMETERS = /^(utm_.*|usp|fbclid|gclid)$/i;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** How often a segment switches between upper and lower case, which a word does once and a random id often. */
function caseChanges(segment: string): number {
  let changes = 0;
  let previous = "";
  for (const letter of segment.replace(/[^A-Za-z]/g, "")) {
    const kind = letter === letter.toUpperCase() ? "upper" : "lower";
    if (previous !== "" && kind !== previous) changes += 1;
    previous = kind;
  }
  return changes;
}

/** A segment that names an account or form rather than a screen: a UUID, or a long token of mixed characters. */
function looksLikeTenantId(segment: string): boolean {
  if (UUID.test(segment)) return true;
  if (segment.length < 8) return false;
  return /\d/.test(segment) || caseChanges(segment) >= 4;
}

/**
 * What a route fragment of a single-page portal says about whose portal it is: the path up to and
 * including the first segment that looks like an id, or the first segment when none does. The
 * screens after it change as the visitor moves through the portal. A fragment that is not a route
 * (an anchor, or tracking such as `xd_co_f=...`) names nobody and is ignored.
 */
function tenantFragment(hash: string): string {
  const lead = hash.startsWith("#!/") ? "#!/" : hash.startsWith("#/") ? "#/" : null;
  if (lead === null) return "";
  const segments = (hash.slice(lead.length).split("?")[0] ?? "").split("/").filter(Boolean);
  if (segments.length === 0) return "";
  const tenant = segments.findIndex(looksLikeTenantId);
  return `${lead}${segments.slice(0, (tenant === -1 ? 0 : tenant) + 1).join("/")}`;
}

/**
 * The pages of one form that live side by side in that form's own folder, such as the page that
 * shows a Google Form and the one that receives it.
 */
const SIBLING_FORM_PAGES = new Set(["viewform", "formresponse"]);

/**
 * What a third-party page covers. A shared platform serves every tenant under the same folder
 * (app.termly.io/dsar/*), so the folder says nothing about whose page it is. The page's own path
 * is the scope, and a tenant named in the query or in a route fragment is required there too.
 */
export function scopeOf(url: string): PageScope | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const segments = parsed.pathname.split("/");
  const last = segments.at(-1) ?? "";
  const path = SIBLING_FORM_PAGES.has(last.toLowerCase())
    ? `${segments.slice(0, -1).join("/")}/`
    : parsed.pathname;
  const query = [...parsed.searchParams].filter(([name]) => !NON_IDENTIFYING_PARAMETERS.test(name));
  const fragment = tenantFragment(parsed.hash);
  return {
    host: bareHost(parsed.hostname),
    path,
    ...(query.length > 0 ? { query } : {}),
    ...(fragment ? { fragment } : {}),
  };
}

function pathWithin(pathname: string, prefix: string): boolean {
  if (prefix.endsWith("/")) return pathname.startsWith(prefix);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

function fragmentWithin(hash: string, prefix: string): boolean {
  if (hash === prefix) return true;
  return hash.startsWith(prefix) && /[/?]/.test(hash.charAt(prefix.length));
}

function sameScope(a: PageScope, b: PageScope): boolean {
  return (
    a.host === b.host &&
    a.path === b.path &&
    a.fragment === b.fragment &&
    JSON.stringify(a.query ?? []) === JSON.stringify(b.query ?? [])
  );
}

function pageAdmits(page: PageScope, parsed: URL): boolean {
  if (page.host !== bareHost(parsed.hostname) || !pathWithin(parsed.pathname, page.path)) {
    return false;
  }
  const queryMatches = (page.query ?? []).every(([name, value]) =>
    parsed.searchParams.getAll(name).includes(value),
  );
  return (
    queryMatches && (page.fragment === undefined || fragmentWithin(parsed.hash, page.fragment))
  );
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
  for (const url of [target.optOutUrl, target.privacyRightsUrl, target.searchUrl, ...extraUrls]) {
    if (url === null || url === undefined || domains.some((host) => isOnDomain(url, host))) {
      continue;
    }
    const scope = scopeOf(url);
    if (scope && !pages.some((page) => sameScope(page, scope))) {
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
  return sites.pages.some((page) => pageAdmits(page, parsed));
}

function describePage(page: PageScope): string {
  const query = (page.query ?? []).map(([name, value]) => `${name}=${value}`).join("&");
  const path = `${page.host}${page.path}${page.path.endsWith("/") ? "*" : ""}`;
  return `${path}${query ? `?${query}` : ""}${page.fragment ?? ""}`;
}

export function describeSites(sites: Pick<NavigationPolicy, "domains" | "pages">): string {
  return [...sites.domains, ...sites.pages.map(describePage)].join(", ");
}

/**
 * Why the page may not stay where it is now, or null. A page that was let in can change its own
 * address without loading anything (a route fragment, or history.pushState on the same origin),
 * and a single-page portal does so on every screen, so a change within the origin of the
 * document that was let in is that document's own business. Any other address is judged like a
 * request for it.
 */
export function refuseCurrentUrl(
  url: string,
  admittedDocument: string | null,
  policy: NavigationPolicy,
): string | null {
  const problem = refuseNavigation(url, policy);
  if (problem === null || admittedDocument === null) return problem;
  try {
    const admitted = new URL(admittedDocument);
    if (new URL(url).origin !== admitted.origin) return problem;
    const host = bareHost(admitted.hostname);
    return refuseNavigation(url, { ...policy, pages: [...policy.pages, { host, path: "/" }] });
  } catch {
    return problem;
  }
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
