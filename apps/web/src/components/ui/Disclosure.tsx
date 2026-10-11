import { ChevronRight } from "lucide-react";
import { type ReactNode, useId } from "react";
import { cn } from "../../lib/cn.js";
import { Icon } from "./Icon.js";

export interface DisclosureProps {
  /** What the section holds, shown on the toggle row. */
  title: string;
  /** One line under the title that says what is inside. */
  description?: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  className?: string;
  children: ReactNode;
}

/**
 * A closed-by-default group of rows behind one toggle row. The content stays mounted while closed
 * so a link elsewhere on the page can still point at something inside it once it opens.
 */
export function Disclosure({
  title,
  description,
  open,
  onOpenChange,
  className,
  children,
}: DisclosureProps) {
  const panel = useId();
  return (
    <section className={cn("min-w-0", className)}>
      <div className="overflow-hidden rounded-md border border-line bg-surface">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={panel}
          onClick={() => onOpenChange(!open)}
          className="marked flex min-h-row w-full items-center gap-3 px-3.5 py-2 text-left transition-colors duration-100 hover:bg-hover focus-visible:-outline-offset-2"
        >
          <Icon
            icon={ChevronRight}
            className={cn("transition-transform duration-100", open && "rotate-90")}
          />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-ui font-medium text-ink">{title}</span>
            {description ? <span className="text-meta text-ink-3">{description}</span> : null}
          </span>
        </button>
      </div>
      <div id={panel} hidden={!open} className="mt-2 flex flex-col gap-4">
        {children}
      </div>
    </section>
  );
}
