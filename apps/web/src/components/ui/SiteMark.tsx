import type { SiteStatus } from "@kickrocks/shared";
import { cn } from "../../lib/cn.js";
import { siteLabel, siteTone } from "../../lib/sites.js";
import { TONE_SHAPE } from "../../lib/status.js";
import { StatusShapeGlyph } from "./StatusMark.js";

const WORD = {
  neutral: "text-ink-2",
  positive: "text-ink-2",
  attention: "text-attention-text font-medium",
  danger: "text-danger-text font-medium",
} as const;

/** How a site is being treated: the shape of its state and a plain word, with no pill behind it. */
export function SiteMark({ site }: { site: Pick<SiteStatus, "breaker" | "coolingDownUntil"> }) {
  const tone = siteTone(site);
  return (
    <span className="inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-meta">
      <StatusShapeGlyph shape={TONE_SHAPE[tone]} />
      <span className={cn(WORD[tone])}>{siteLabel(site)}</span>
    </span>
  );
}
