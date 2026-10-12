import { Info } from "lucide-react";
import { Tooltip } from "./Tooltip.js";

/**
 * An info mark that holds the rest of an explanation, so the line beside it can stay one
 * sentence. The label names what the mark explains; the text is the tooltip and the description.
 */
export function InfoTip({ text, label = "More detail" }: { text: string; label?: string }) {
  return (
    <Tooltip content={text} hintOnTap>
      <button
        type="button"
        aria-label={label}
        aria-description={text}
        className="relative ml-1 inline-flex size-4 translate-y-0.5 items-center justify-center rounded-sm text-ink-3 before:absolute before:-inset-1 before:content-[''] hover:text-ink-2"
      >
        <Info aria-hidden="true" width={14} height={14} strokeWidth={1.5} />
      </button>
    </Tooltip>
  );
}
