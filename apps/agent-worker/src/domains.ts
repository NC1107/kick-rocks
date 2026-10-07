import { isOnDomain, type TargetSummary } from "@kickrocks/shared";

function hostOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/** The hosts an agent may visit for a target, which are the target's own and nothing else. */
export function allowedDomainsFor(
  target: TargetSummary,
  extraUrls: (string | null)[] = [],
): string[] {
  const hosts = [
    target.domain.toLowerCase().replace(/^www\./, ""),
    hostOf(target.website),
    hostOf(target.optOutUrl),
    hostOf(target.searchUrl),
    ...extraUrls.map(hostOf),
  ];
  return [...new Set(hosts.filter((host): host is string => host !== null && host !== ""))];
}

export interface NavigationPolicy {
  domains: readonly string[];
  allowHttp: boolean;
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
  if (!policy.domains.some((domain) => isOnDomain(url, domain))) {
    return `${parsed.hostname} is not one of this target's domains (${policy.domains.join(", ")})`;
  }
  return null;
}
