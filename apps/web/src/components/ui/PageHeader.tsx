import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";
import { usePageTitle } from "../../lib/use-page-title.js";
import { type BackTarget, PageBack } from "./PageBack.js";

export interface PageHeaderProps {
  title: string;
  /** The tab title when the heading alone would repeat across pages. Defaults to the heading. */
  documentTitle?: string;
  /** Eight words or fewer, or leave it out. */
  description?: ReactNode;
  /** For a line that only describes the page, which a phone has no room for. */
  hideDescriptionOnPhone?: boolean;
  /** Buttons that act on the whole page. The main one goes last. */
  actions?: ReactNode;
  /**
   * Where back leads. "auto", the default, is the page a link came from, else the parent in the
   * header trail. Pass a destination only when the page has one parent however it was reached.
   */
  back?: BackTarget | "auto";
}

/** The top of every page. It also sets the browser tab title, so a page never has to. */
export function PageHeader({
  title,
  documentTitle,
  description,
  hideDescriptionOnPhone = false,
  actions,
  back = "auto",
}: PageHeaderProps) {
  usePageTitle(documentTitle ?? title);
  return (
    <header className="mb-5 border-b border-line pb-3">
      {back === "auto" ? <PageBack /> : <PageBack explicit={back} />}
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <h1 className="text-title font-semibold tracking-[-0.01em] text-ink max-sm:text-[1.25rem]/[1.5rem]">
            {title}
          </h1>
          {description ? (
            <p
              className={cn(
                "min-w-0 text-meta text-ink-3",
                hideDescriptionOnPhone && "max-sm:hidden",
              )}
            >
              {description}
            </p>
          ) : null}
        </div>
        {actions ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
        ) : null}
      </div>
    </header>
  );
}
