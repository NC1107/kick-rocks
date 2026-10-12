import { Info } from "lucide-react";
import { Tooltip } from "./Tooltip.js";

/**
 * An info mark that holds the rest of an explanation, so the line beside it can stay one
 * sentence. The text is both the tooltip and the accessible name.
 */
export function InfoTip({ text }: { text: string }) {
  return (
    <Tooltip content={text} hintOnTap>
      <button
        type="button"
        aria-label={text}
        className="ml-1 inline-flex size-4 translate-y-0.5 items-center justify-center rounded-sm text-ink-3 hover:text-ink-2"
      >
        <Info aria-hidden="true" width={14} height={14} strokeWidth={1.5} />
      </button>
    </Tooltip>
  );
}
