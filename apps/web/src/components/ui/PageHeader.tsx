import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { usePageTitle } from "../../lib/use-page-title.js";

export interface PageHeaderProps {
  title: string;
  /** Eight words or fewer, or leave it out. */
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
    <header className="mb-5 border-b border-line pb-3">
      {back ? (
        <Link
          to={back.to}
          className="-ml-1 mb-1.5 inline-flex items-center gap-0.5 rounded-xs pr-1 text-meta text-ink-3 transition-colors duration-100 hover:text-ink-2"
        >
          <ChevronLeft aria-hidden="true" className="size-4" />
          {back.label}
        </Link>
      ) : null}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="text-title font-semibold tracking-[-0.01em] text-ink max-sm:text-[1.25rem]/[1.5rem]">
            {title}
          </h1>
          {description ? <p className="min-w-0 text-meta text-ink-3">{description}</p> : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
