import { ChevronLeft } from "lucide-react";
import type { MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";

/**
 * Whether an earlier screen of the app sits behind this one. The browser history keeps a position
 * that a replace does not advance, so a first screen reached through a login or setup redirect
 * still reads as the start of the visit, which a location key cannot tell.
 */
function hasEarlierScreen(): boolean {
  const position: unknown = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof position === "number" && position > 0;
}

/**
 * Back to where the person came from, or to the page's logical parent when this is the first
 * screen of the visit. The control says "Back" when it returns to an earlier screen, because its
 * link still points at the parent for new tabs and the two can differ.
 */
export function PageBack({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  // The location is read so the answer is recomputed on every navigation.
  useLocation();
  const cameFromInApp = hasEarlierScreen();

  const goBack = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!cameFromInApp || event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
      return;
    }
    event.preventDefault();
    navigate(-1);
  };

  return (
    <Link
      to={to}
      onClick={goBack}
      className="-ml-1 mb-1.5 inline-flex items-center gap-0.5 rounded-xs pr-1 text-meta max-sm:-mt-3 max-sm:-mb-2 max-sm:min-h-11 pointer-coarse:min-h-11 text-ink-3 transition-colors duration-100 hover:text-ink-2"
    >
      <ChevronLeft aria-hidden="true" className="size-4" />
      {cameFromInApp ? "Back" : label}
    </Link>
  );
}
