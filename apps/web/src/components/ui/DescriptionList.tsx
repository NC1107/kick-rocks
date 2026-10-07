import type { ReactNode } from "react";
import { cn } from "../../lib/cn.js";

export interface DescriptionItem {
  term: string;
  description: ReactNode;
}

/** Labelled facts about one thing, such as a target or a mailbox. Stacks on a phone. */
export function DescriptionList({
  items,
  className,
}: {
  items: readonly DescriptionItem[];
  className?: string;
}) {
  return (
    <dl className={cn("m-0 divide-y divide-line text-ui", className)}>
      {items.map((item) => (
        <div
          key={item.term}
          className="grid items-baseline gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[11rem_1fr] sm:gap-4"
        >
          <dt className="text-meta text-ink-3">{item.term}</dt>
          <dd className="m-0 min-w-0 break-words text-ink">{item.description}</dd>
        </div>
      ))}
    </dl>
  );
}
