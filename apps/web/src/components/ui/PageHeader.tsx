import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Link, useInRouterContext, useLocation } from "react-router";
import { usePageTitle } from "../../lib/use-page-title.js";
import { breadcrumbTrail } from "../layout/breadcrumb.js";

export interface PageHeaderProps {
  title: string;
  /** The tab title when the heading alone would repeat across pages. Defaults to the heading. */
  documentTitle?: string;
  /** Eight words or fewer, or leave it out. */
  description?: ReactNode;
  /** Buttons that act on the whole page. The main one goes last. */
  actions?: ReactNode;
  /** A link back to the page this one belongs to. Left out, it is the parent in the breadcrumb trail. */
  back?: { to: string; label: string };
}

const BACK_CLASS =
  "-ml-1 mb-1.5 inline-flex items-center gap-0.5 rounded-xs pr-1 text-meta max-sm:-mt-3 max-sm:-mb-2 max-sm:min-h-11 pointer-coarse:min-h-11 text-ink-3 transition-colors duration-100 hover:text-ink-2";

function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className={BACK_CLASS}>
      <ChevronLeft aria-hidden="true" className="size-4" />
      {label}
    </Link>
  );
}

/** Every page but the dashboard has a way back, to its parent in the breadcrumb trail or else the dashboard, which a phone has no browser button for. */
function ParentLink() {
  const { pathname } = useLocation();
  if (pathname === "/") return null;
  const parent = breadcrumbTrail(pathname).slice(0, -1).at(-1);
  return parent?.to ? (
    <BackLink to={parent.to} label={parent.label} />
  ) : (
    <BackLink to="/" label="Dashboard" />
  );
}

/** The top of every page. It also sets the browser tab title, so a page never has to. */
export function PageHeader({ title, documentTitle, description, actions, back }: PageHeaderProps) {
  usePageTitle(documentTitle ?? title);
  const inRouter = useInRouterContext();
  return (
    <header className="mb-5 border-b border-line pb-3">
      {back ? <BackLink to={back.to} label={back.label} /> : inRouter ? <ParentLink /> : null}
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
