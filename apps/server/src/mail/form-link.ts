import { isOnDomain, WebUrl } from "@kickrocks/shared";

/** Words in a link or its text that say it leads to a place where a request is made. */
export const FORM_LINK_HINT =
  /form|portal|privacy[-_ ]?(?:request|rights|choices|cent(?:er|re)|portal)|request[-_ ]?(?:cent(?:er|re)|portal)|opt-?out|do[-_ ]?not[-_ ]?sell|one-?trust|trust-?arc|ccpa|dsar|data[-_ ]?subject|ticket|submit/i;

/**
 * The first of these web addresses that sits on one of the domains and says what it is. A
 * confirmation token or a policy page on the same site is not a form, so it is left out.
 */
export function formLinkAmong(urls: readonly string[], domains: readonly string[]): string | null {
  return (
    urls.find(
      (url) =>
        WebUrl.safeParse(url).success &&
        FORM_LINK_HINT.test(url) &&
        domains.some((domain) => isOnDomain(url, domain)),
    ) ?? null
  );
}
