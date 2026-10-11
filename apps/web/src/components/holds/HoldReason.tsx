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
}

function say(hold: ScanHold, compact: boolean, { profileId, targetId }: Subject): Say {
  const domain = hold.domain ? <span className="font-mono">{hold.domain}</span> : "the site";
  const sites = hold.domain ? null : "Sites";
  const site =
    hold.domain && targetId ? (
      <EntityLink
        to={{ kind: "target", id: targetId, name: hold.domain }}
        variant="quiet"
        className="relative font-mono underline"
      >
        {hold.domain}
      </EntityLink>
    ) : (
      domain
    );
  const after = hold.until ? <>, {waitLength(hold.until)}</> : null;
  switch (hold.reason) {
    case "quiet_hours":
      return {
        shape: "ring",
        text: <QuietHours hold={hold} compact={compact} />,
        link: hold.serverClock
          ? { to: paths.settings("scan-pace"), label: "Set time zone" }
          : { to: paths.settings("scan-pace"), label: "Quiet hours" },
      };
    case "site_cooldown":
      return {
        shape: "ring",
        text: (
          <>
            {sites ?? site} cooling down{after}
          </>
        ),
        link: { to: paths.settings("sites"), label: "Sites" },
      };
    case "site_breaker":
      return {
        shape: "ring",
        text: (
          <>
            {sites ?? site} paused after pushback{after}
          </>
        ),
        link: { to: paths.settings("sites"), label: "Sites" },
      };
    case "site_busy":
      return { shape: "ring", text: <>Another task is on {site}</> };
    case "site_gap":
      return { shape: "ring", text: <>Spacing out visits to {site}</> };
    case "site_daily_cap":
      return {
        shape: "ring",
        text: <>{site} has had its visits for today</>,
        link: { to: paths.settings("scan-pace"), label: "Pace" },
      };
    case "hourly_cap":
      return {
        shape: "ring",
        text: "Hourly limit reached",
        link: { to: paths.settings("scan-pace"), label: "Pace" },
      };
    case "daily_cap":
      return {
        shape: "ring",
        text: "Daily limit reached",
        link: { to: paths.settings("scan-pace"), label: "Pace" },
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
        link: { to: paths.settings("agents"), label: "Agents" },
      };
    case "agent_required":
      return {
        shape: "ring",
        text: "Waiting for an agent",
        link: { to: paths.settings("agents"), label: "Agents" },
      };
    case "recipe_unapproved":
      return {
        shape: "triangle",
        text: "Recipe waits for your review",
        link: { to: paths.settings("recipes"), label: "Recipes" },
      };
    case "recipe_unverified":
      return {
        shape: "ring",
        text: "Recipe not verified yet",
        link: { to: paths.settings("recipes"), label: "Recipes" },
      };
  }
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
  profileId,
  targetId,
}: {
  hold: ScanHold | TaskWaiting;
  compact?: boolean;
  /** The profile a missing detail would be added to. */
  profileId?: string | undefined;
  /** The site the hold is about, so its domain leads to the site's page. */
  targetId?: string | null | undefined;
}) {
  const view = say(hold, compact, { profileId, targetId: targetId ?? undefined });
  return (
    <span className="inline-flex min-w-0 items-baseline gap-1.5 text-meta text-ink-2">
      <StatusShapeGlyph shape={view.shape} className="translate-y-px" />
      <span className="min-w-0">
        {compact ? null : <span className="text-ink-3">{lead(hold)}: </span>}
        {view.text}
        {view.link ? (
          <>
            {" "}
            <TextLink to={view.link.to} className="relative whitespace-nowrap">
              {view.link.label}
            </TextLink>
          </>
        ) : null}
      </span>
    </span>
  );
}
