import { ChevronLeft } from "lucide-react";
import type { MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { cn } from "../../lib/cn.js";
import { breadcrumbTrail } from "../layout/breadcrumb.js";
import { useBreadcrumbTailValue } from "../layout/breadcrumb-context.js";

export interface BackTarget {
  to: string;
  label: string;
}

/** What an EntityLink leaves in `location.state`, so the page it opens can lead back. */
export interface FromState {
  from: BackTarget;
}

function readFrom(state: unknown): BackTarget | null {
  if (typeof state !== "object" || state === null || !("from" in state)) return null;
  const from = (state as { from?: Partial<BackTarget> | null }).from;
  return typeof from?.to === "string" && typeof from.label === "string"
    ? { to: from.to, label: from.label }
    : null;
}

/** The page the person is on, in the shape a link passes along as the place to come back to. */
export function useCurrentPage(): BackTarget {
  const { pathname, search } = useLocation();
  const tail = useBreadcrumbTailValue();
  const label = breadcrumbTrail(pathname, tail).at(-1)?.label ?? "Back";
  return { to: `${pathname}${search}`, label };
}

/** The crumb a person would climb to: the parent in the header trail. */
function useTrailParent(): BackTarget | null {
  const { pathname } = useLocation();
  const tail = useBreadcrumbTailValue();
  const parent = breadcrumbTrail(pathname, tail)
    .slice(0, -1)
    .reverse()
    .find((crumb) => crumb.to);
  return parent?.to ? { to: parent.to, label: parent.label } : null;
}

export interface ResolvedBack extends BackTarget {
  /** Whether the header trail already shows this same parent, which a wide screen does not repeat. */
  inTrail: boolean;
}

/**
 * Where back goes: the page the person came from when a link said so, else the parent in the
 * trail, else the fallback the frame gave. Null on a page with no parent at all.
 */
export function useBackTarget(fallback?: BackTarget, fixed?: BackTarget): ResolvedBack | null {
  const location = useLocation();
  const parent = useTrailParent();
  const from = readFrom(location.state);
  const current = `${location.pathname}${location.search}`;
  if (fixed) return { ...fixed, inTrail: fixed.to === parent?.to };
  if (from && from.to !== current) return { ...from, inTrail: from.to === parent?.to };
  const chosen = fallback ?? parent;
  return chosen ? { ...chosen, inTrail: chosen.to === parent?.to } : null;
}

/**
 * Whether an earlier screen of the app sits behind this one. The browser history keeps a position
 * that a replace does not advance, so a first screen reached through a login or setup redirect
 * still reads as the start of the visit, which a location key cannot tell.
 */
function hasEarlierScreen(): boolean {
  const position: unknown = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof position === "number" && position > 0;
}

const LINK_CLASS =
  "-ml-1 mb-1.5 inline-flex items-center gap-0.5 rounded-xs pr-1 text-meta max-sm:-mt-3 max-sm:-mb-2 max-sm:min-h-11 pointer-coarse:min-h-11 text-ink-3 transition-colors duration-100 hover:text-ink-2";

/**
 * A link back to where the person came from, by history when an earlier screen exists. It shows at every width below sm, where the header
 * trail is hidden, and on a wide screen only when the trail does not already show the same page.
 * Frames that do not use PageHeader place it themselves.
 */
export function PageBack({
  fallback,
  explicit,
  className,
}: {
  fallback?: BackTarget;
  /** A fixed destination, for a page whose parent never varies. */
  explicit?: BackTarget;
  className?: string;
}) {
  const target = useBackTarget(fallback, explicit);
  const navigate = useNavigate();
  const cameFromInApp = hasEarlierScreen();
  if (!target) return null;

  // History comes first so back returns to the exact screen, scroll and filters included. The
  // link keeps pointing at the resolved target for new tabs and for a first screen of the visit.
  const goBack = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!cameFromInApp || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    navigate(-1);
  };

  return (
    <Link
      to={target.to}
      onClick={goBack}
      className={cn(LINK_CLASS, target.inTrail && "sm:hidden", className)}
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      {cameFromInApp ? "Back" : target.label}
    </Link>
  );
}
