import type { ReactNode } from "react";
import { usePageTitle } from "../../lib/use-page-title.js";
import { PageBack } from "./PageBack.js";

export interface PageHeaderProps {
  title: string;
  /** The tab title when the heading alone would repeat across pages. Defaults to the heading. */
  documentTitle?: string;
  /** Eight words or fewer, or leave it out. */
  description?: ReactNode;
  /** Buttons that act on the whole page. The main one goes last. */
  actions?: ReactNode;
  /** The logical parent, used when the person did not arrive from inside the app. */
  back?: { to: string; label: string };
}

/** The top of every page. It also sets the browser tab title, so a page never has to. */
export function PageHeader({ title, documentTitle, description, actions, back }: PageHeaderProps) {
  usePageTitle(documentTitle ?? title);
  return (
    <header className="mb-5 border-b border-line pb-3">
      {back ? <PageBack to={back.to} label={back.label} /> : null}
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
