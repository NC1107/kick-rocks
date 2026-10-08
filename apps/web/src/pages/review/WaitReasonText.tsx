import type { WaitReason } from "@kickrocks/shared";
import type { ReactNode } from "react";

function Domain({ children }: { children: string }) {
  return <span className="font-mono">{children}</span>;
}

/** Sentence-case copy for a Waiting row, naming the site the row is about. */
export function WaitReasonText({ reason, domain }: { reason: WaitReason; domain: string }) {
  const text: Record<WaitReason, ReactNode> = {
    site_busy: (
      <>
        Another task is already running on <Domain>{domain}</Domain>
      </>
    ),
    site_gap: (
      <>
        Spacing out visits to <Domain>{domain}</Domain>
      </>
    ),
    site_daily_cap: (
      <>
        <Domain>{domain}</Domain> has had its visits for today
      </>
    ),
    hourly_cap: "Hourly limit across all sites reached",
    daily_cap: "Daily limit across all sites reached",
    quiet_hours: "Quiet hours, so browser tasks start later",
    site_cooldown: (
      <>
        <Domain>{domain}</Domain> asked for a break
      </>
    ),
    site_breaker: (
      <>
        <Domain>{domain}</Domain> is paused after repeated pushback
      </>
    ),
  };
  return text[reason];
}
