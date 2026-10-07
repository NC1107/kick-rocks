import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { usePageTitle } from "../../lib/use-page-title.js";

export interface PageHeaderProps {
  title: string;
  description?: ReactNode;
  /** Buttons that act on the whole page. The main one goes last. */
  actions?: ReactNode;
  /** A link back to the list this page belongs to. */
  back?: { to: string; label: string };
}

/** The top of every page. It also sets the browser tab title, so a page never has to. */
export function PageHeader({ title, description, actions, back }: PageHeaderProps) {
  usePageTitle(title);
  return (
    <header className="mb-6">
      {back ? (
        <Link
          to={back.to}
          className="-ml-1 mb-2 inline-flex items-center gap-0.5 rounded-sm pr-1 text-sm text-ink-muted hover:text-ink"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
          {description ? (
            <p className="mt-1 max-w-2xl text-base text-ink-muted">{description}</p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
