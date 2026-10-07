import type { ReactNode } from "react";

export interface DetailFrameProps {
  /** Names the region for screen readers and for the shortcut that moves focus into it. */
  label: string;
  title: ReactNode;
  /** One line under the title: where it came from and how old it is. */
  meta?: ReactNode;
  children?: ReactNode;
  /** The decision controls. They stay at the bottom edge while the body scrolls. */
  footer?: ReactNode;
}

/**
 * The right half of the review queue: what the item is, then the controls that decide it. On a
 * wide screen the body scrolls inside the pane and the footer never moves; on a phone the page
 * scrolls and the footer sticks to the bottom of the screen.
 */
export function DetailFrame({ label, title, meta, children, footer }: DetailFrameProps) {
  return (
    <section aria-label={label} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 px-4 py-4 sm:px-5 lg:overflow-y-auto">
        <h2 className="break-words text-heading font-semibold text-ink">{title}</h2>
        {meta ? <p className="mt-0.5 break-words text-meta text-ink-3">{meta}</p> : null}
        {children ? <div className="mt-4 flex flex-col gap-4">{children}</div> : null}
      </div>
      {footer ? (
        <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-2 rounded-b-md border-t border-line bg-canvas px-4 py-3 sm:px-5 max-sm:grid max-sm:grid-cols-2 max-sm:[&>*]:min-w-0 max-sm:[&>button]:w-full max-sm:[&>form]:col-span-full max-sm:[&>span]:col-span-full">
          {footer}
        </div>
      ) : null}
    </section>
  );
}
