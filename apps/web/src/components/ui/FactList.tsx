import type { LucideIcon } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";
import { cn } from "../../lib/cn.js";
import { Tooltip } from "./Tooltip.js";

export interface FactItem {
  term: string;
  value: ReactNode;
  /** Identifiers, dates and numbers are data, so they are set in mono. */
  mono?: boolean | undefined;
  icon?: LucideIcon | undefined;
  /** Explains the value in a tooltip, such as the statute behind a short code. */
  hint?: string | undefined;
}

export interface FactListProps {
  items: readonly FactItem[];
  /**
   * "split" keeps the term beside the value, "stacked" puts it above. "auto" splits from a phone
   * 360px wide up, so only a narrower screen stacks.
   */
  layout?: "stacked" | "split" | "auto";
  dense?: boolean;
  /** Draws the box. Turn it off inside something that already has one. */
  bordered?: boolean;
  className?: string;
}

const LAYOUTS = {
  stacked: "grid-cols-1",
  split: "grid-cols-[var(--fact-term)_minmax(0,1fr)]",
  auto: "grid-cols-1 min-[360px]:grid-cols-[var(--fact-term)_minmax(0,1fr)]",
} as const;

/**
 * Labelled facts about one thing: a request, a target, a mailbox. Rows are hairline-divided and
 * the terms line up, so a screen of facts reads as one table of values rather than a stack of cards.
 */
export function FactList({
  items,
  layout = "auto",
  dense = false,
  bordered = true,
  className,
}: FactListProps) {
  const style = { "--fact-term": dense ? "5.5rem" : "8.5rem" } as CSSProperties;
  return (
    <dl
      style={style}
      className={cn(
        "m-0 min-w-0 divide-y divide-line",
        bordered && "overflow-hidden rounded-md border border-line bg-surface",
        className,
      )}
    >
      {items.map((item) => {
        const Glyph = item.icon;
        const value = (
          <dd
            className={cn(
              "m-0 min-w-0 break-words text-ink",
              item.mono ? "font-mono text-meta" : "text-ui",
            )}
          >
            {item.value}
          </dd>
        );
        return (
          <div
            key={item.term}
            className={cn(
              "grid items-baseline gap-x-4",
              LAYOUTS[layout],
              bordered && "px-3.5",
              dense ? "min-h-9 gap-y-0 py-1.5" : "min-h-row gap-y-0.5 py-2",
            )}
          >
            <dt className="flex items-center gap-1.5 text-meta text-ink-3">
              {Glyph ? <Glyph aria-hidden="true" className="size-3.5 shrink-0" /> : null}
              {item.term}
            </dt>
            {item.hint ? (
              <Tooltip content={item.hint} hintOnTap>
                {value}
              </Tooltip>
            ) : (
              value
            )}
          </div>
        );
      })}
    </dl>
  );
}
