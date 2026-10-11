import { ChevronLeft } from "lucide-react";
import { Link, useLocation } from "react-router";
import { cn } from "../../lib/cn.js";
import { breadcrumbTrail } from "../layout/breadcrumb.js";

export interface BackTarget {
  to: string;
  label: string;
}

function isBackTarget(value: unknown): value is { path: string; label: string } {
  if (typeof value !== "object" || value === null) return false;
  const { path, label } = value as Record<string, unknown>;
  return typeof path === "string" && typeof label === "string";
}

/**
 * Where the person came from if an entity link set it, else the page above this one in the
 * breadcrumb, else the fallback. A top-level page with none of these has nowhere to go back to.
 */
function useBackTarget(fallback: BackTarget | undefined): {
  target: BackTarget | null;
  parent: string | undefined;
} {
  const location = useLocation();
  const trail = breadcrumbTrail(location.pathname);
  const parent = trail.length > 1 ? trail.at(-2) : undefined;
  const from = (location.state as { from?: unknown } | null)?.from;
  if (isBackTarget(from)) {
    return { target: { to: from.path, label: from.label }, parent: parent?.to };
  }
  if (parent?.to) return { target: { to: parent.to, label: parent.label }, parent: parent.to };
  return { target: fallback ?? null, parent: undefined };
}

const BACK_CLASS =
  "-ml-1 mb-1.5 inline-flex items-center gap-0.5 rounded-xs pr-1 text-meta max-sm:-mt-3 max-sm:-mb-2 max-sm:min-h-11 pointer-coarse:min-h-11 text-ink-3 transition-colors duration-100 hover:text-ink-2";

/**
 * A link back, shown at every width below `sm`, where the breadcrumb is hidden. From `sm` up it
 * hides when the breadcrumb already links to the same page.
 */
export function PageBack({
  fallback,
  explicit,
  className,
}: {
  fallback?: BackTarget;
  /** A target the page names itself, which wins over where the person came from. */
  explicit?: BackTarget | undefined;
  className?: string;
}) {
  const { target, parent } = useBackTarget(fallback);
  const shown = explicit ?? target;
  if (!shown) return null;
  return (
    <Link to={shown.to} className={cn(BACK_CLASS, shown.to === parent && "sm:hidden", className)}>
      <ChevronLeft aria-hidden="true" className="size-4" />
      {shown.label}
    </Link>
  );
}
