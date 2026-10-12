import { API_ROUTES, type ProfileField, type ScanHold, type TaskWaiting } from "@kickrocks/shared";
import type { ReactNode } from "react";
import { useApiQuery } from "../../api/index.js";
import { PROFILE_FIELD_LABELS } from "../../lib/labels.js";
import { paths } from "../../lib/paths.js";
import type { StatusShape } from "../../lib/status.js";
import { EntityLink, StatusShapeGlyph, TextLink } from "../ui/index.js";
import { formatQuietEnd } from "./hold-text.js";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "5h" for the time left until an instant: short enough for a row, never a clock time in the wrong zone. */
function waitLength(iso: string, now = Date.now()): string {
  const left = Math.max(0, Date.parse(iso) - now);
  if (left < HOUR) return `${Math.max(1, Math.round(left / MINUTE))}m`;
  if (left < DAY) return `${Math.round(left / HOUR)}h`;
  return `${Math.round(left / DAY)}d`;
}

/** When a hold lifts, as the viewer's own clock reads it: a time today, else the date. */
function untilText(iso: string, now = Date.now()): string {
  const at = new Date(iso);
  if (at.getTime() - now < DAY) {
    return at.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  return at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** The hour quiet hours end, read in the same zone the server reads them in. */
function useQuietEnd(): string | null {
  const settings = useApiQuery(API_ROUTES.settingsGet);
  const hour = settings.data?.scanning.quietEndHour;
  return hour === undefined ? null : formatQuietEnd(hour);
}

function fieldWords(fields: readonly ProfileField[]): string {
  return fields.map((field) => PROFILE_FIELD_LABELS[field].toLowerCase()).join(" and ");
}

interface Say {
  shape: StatusShape;
  text: ReactNode;
  link?: { to: string; label: string };
}

function QuietHours({ hold, compact }: { hold: ScanHold; compact: boolean }) {
  const until = useQuietEnd();
  const end = until ?? (hold.until ? `in ${waitLength(hold.until)}` : "later");
  const zone = hold.serverClock
    ? compact
      ? " (server clock)"
      : " (server clock, no time zone set)"
    : "";
  return (
    <>
      Quiet hours until {until ? <span className="font-mono">{end}</span> : end}
      {zone}
    </>
  );
}

interface Subject {
  profileId: string | undefined;
  targetId: string | undefined;
  /** False where the row already names the site, so its domain is not said again. */
  showSite: boolean;
}

function say(hold: ScanHold, compact: boolean, { profileId, targetId, showSite }: Subject): Say {
  const named = showSite && hold.domain;
  const domain = named ? <span className="font-mono">{hold.domain}</span> : "the site";
  const sites = hold.domain ? null : "Sites";
  const site =
    named && targetId ? (
      <EntityLink
        to={{ kind: "target", id: targetId, name: named }}
        variant="quiet"
        className="relative font-mono underline"
      >
        {hold.domain}
      </EntityLink>
    ) : (
      domain
    );
  const subject = named ? site : (sites ?? "The site");
  // Without a verb "The site cooling down" reads as a fragment, so a row that does not name the site starts with the verb.
  const bare = !named && sites === null;
  const after = hold.until ? <> until {untilText(hold.until)}</> : null;
  switch (hold.reason) {
    case "quiet_hours":
      return {
        shape: "ring",
        text: <QuietHours hold={hold} compact={compact} />,
        link: hold.serverClock
          ? { to: paths.settings("scan-pace"), label: "Set time zone" }
          : { to: paths.settings("scan-pace"), label: "Set quiet hours" },
      };
    case "site_cooldown":
      return {
        shape: "ring",
        text: (
          <>
            {bare ? "Cooling down" : <>{subject} cooling down</>}
            {after}
          </>
        ),
        link: { to: paths.settings("sites"), label: "Site settings" },
      };
    case "site_breaker":
      return {
        shape: "ring",
        text: (
          <>
            {bare ? "Paused after pushback" : <>{subject} paused after pushback</>}
            {after}
          </>
        ),
        link: { to: paths.settings("sites"), label: "Site settings" },
      };
    case "site_busy":
      return { shape: "ring", text: <>Another task is on {site}</> };
    case "site_gap":
      return { shape: "ring", text: <>Spacing out visits to {site}</> };
    case "site_daily_cap":
      return {
        shape: "ring",
        text: <>{site} has had its visits for today</>,
        link: { to: paths.settings("scan-pace"), label: "Pace settings" },
      };
    case "hourly_cap":
      return {
        shape: "ring",
        text: "Hourly limit reached",
        link: { to: paths.settings("scan-pace"), label: "Pace settings" },
      };
    case "daily_cap":
      return {
        shape: "ring",
        text: "Daily limit reached",
        link: { to: paths.settings("scan-pace"), label: "Pace settings" },
      };
    case "missing_fields":
      return {
        shape: "triangle",
        text: hold.fields?.length
          ? `Profile has no ${fieldWords(hold.fields)}`
          : "Profile is missing details",
        ...(profileId ? { link: { to: paths.profile(profileId), label: "Edit profile" } } : {}),
      };
    case "no_recipe":
      return {
        shape: "ring",
        text: "Waiting for an agent, no scripted search",
        link: { to: paths.settings("agents"), label: "Connect an agent" },
      };
    case "agent_required":
      return {
        shape: "ring",
        text: "Waiting for an agent",
        link: { to: paths.settings("agents"), label: "Connect an agent" },
      };
    case "recipe_unapproved":
      return {
        shape: "triangle",
        text: "Recipe waits for your review",
        link: { to: paths.settings("recipes"), label: "Review recipes" },
      };
  }
}

/** The label of the link a hold carries, so a list can show a shared link once. */
export function holdLinkLabel(
  hold: ScanHold | TaskWaiting,
  profileId?: string,
): string | undefined {
  return say(hold, true, { profileId, targetId: undefined, showSite: false }).link?.label;
}

function lead(hold: ScanHold): string {
  return hold.reason === "missing_fields" || hold.reason === "recipe_unapproved"
    ? "Skipped"
    : "Held";
}

/**
 * Says why a task is not starting, with a shape so it reads without color, and a link to the
 * place that changes it. A person who sees "Queued" for hours needs this sentence, not a wait.
 */
export function HoldReason({
  hold,
  compact = false,
  glyph = true,
  showSite = true,
  profileId,
  targetId,
  hideLink = false,
}: {
  hold: ScanHold | TaskWaiting;
  compact?: boolean;
  /** False where the row already carries a status mark, so the row has one. */
  glyph?: boolean;
  /** False where the row already names the site. */
  showSite?: boolean;
  /** The profile a missing detail would be added to. */
  profileId?: string | undefined;
  /** The site the hold is about, so its domain leads to the site's page. */
  targetId?: string | null | undefined;
  /** True for the second row of a list whose link a row above already offers. */
  hideLink?: boolean;
}) {
  const view = say(hold, compact, { profileId, targetId: targetId ?? undefined, showSite });
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5 text-meta text-ink-2">
      {glyph ? <StatusShapeGlyph shape={view.shape} className="translate-y-px" /> : null}
      <span className="min-w-0">
        {compact ? null : <span className="text-ink-3">{lead(hold)}: </span>}
        {view.text}
        {view.link && !hideLink ? (
          <>
            <span aria-hidden="true" className="px-1.5 text-ink-3">
              {"·"}
            </span>
            <TextLink to={view.link.to} className="relative whitespace-nowrap">
              {view.link.label}
            </TextLink>
          </>
        ) : null}
      </span>
    </span>
  );
}
