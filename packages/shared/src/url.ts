import { z } from "zod";

/**
 * A link that is rendered or opened. `z.url()` alone accepts `javascript:` and `data:` URLs, which
 * must never reach an anchor, a browser, or an agent, so every URL field uses this instead.
 */
export const WebUrl = z.url({ protocol: /^https?$/ });
export type WebUrl = z.infer<typeof WebUrl>;

function hostOf(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** Whether a web URL points at a domain or one of its subdomains, so `evilspokeo.com` is not `spokeo.com`. */
export function isOnDomain(url: string, domain: string): boolean {
  const host = hostOf(url);
  if (host === null) return false;
  const base = domain.toLowerCase().replace(/^www\./, "");
  return host === base || host === `www.${base}` || host.endsWith(`.${base}`);
}

/**
 * One spelling of a record URL, so the scan that finds a record, the person who confirms it, and
 * the recipe that clicks it agree they mean the same page. The scheme, a leading `www.`, the
 * fragment, a default port, and trailing slashes do not change which record a URL names.
 */
export function normalizeRecordUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const port = parsed.port ? `:${parsed.port}` : "";
  const path = parsed.pathname.replace(/\/+$/, "");
  return `${host}${port}${path}${parsed.search}`;
}
