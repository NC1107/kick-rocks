import { ChevronLeft } from "lucide-react";
import type { MouseEvent } from "react";
import { Link, useLocation, useNavigate } from "react-router";

/**
 * Back to where the person came from. The router marks the first screen of a visit with the key
 * "default", so any other key means there is an earlier screen inside the app to return to;
 * otherwise the link goes to the page's logical parent.
 */
export function PageBack({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  const cameFromInApp = useLocation().key !== "default";

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
      {label}
    </Link>
  );
}
