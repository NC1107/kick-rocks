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
 * A closed-by-default group of rows behind one text-link toggle line (a chevron and a label, no box). The content stays mounted while closed
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
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => onOpenChange(!open)}
        className="-mx-1 flex min-h-row items-center gap-2 rounded-sm px-1 text-left text-ui font-medium text-accent-text hover:underline"
      >
        <Icon
          icon={ChevronRight}
          className={cn("transition-transform duration-100", open && "rotate-90")}
        />
        <span>{title}</span>
        {description ? (
          <span className="min-w-0 truncate text-meta font-normal text-ink-3">{description}</span>
        ) : null}
      </button>
      <div id={panel} hidden={!open} className="mt-1 flex flex-col gap-4">
        {children}
      </div>
    </section>
  );
}
