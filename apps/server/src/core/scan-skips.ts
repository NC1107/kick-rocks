import type { SkipReason } from "@kickrocks/shared";

type SiteChoice = Extract<SkipReason, "site_paused" | "site_skipped">;

/**
 * Whether a scan leaves a site alone because of what the person chose. Naming a site outright
 * overrides a pause, because they asked, but never a skip, which they have to undo first.
 */
export function scanDropReason(blocked: SiteChoice | null, named: boolean): SiteChoice | null {
  if (blocked === null) return null;
  return named && blocked === "site_paused" ? null : blocked;
}

export function siteChoiceDetail(reason: SiteChoice, siteName: string): string {
  return reason === "site_skipped"
    ? `You skipped ${siteName} for this profile. Unskip it to scan it.`
    : `You paused ${siteName} for this profile.`;
}
