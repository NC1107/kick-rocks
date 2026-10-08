import { cn } from "../../lib/cn.js";
import { CopyButton } from "./CopyButton.js";

export interface CodeBlockProps {
  code: string;
  /** Shown in the header, such as "bash" or "mcp.json". */
  title?: string;
  className?: string;
}

/** A command or config the person will copy. Long lines scroll, so a token is never cut in two. The copy button is always there. */
export function CodeBlock({ code, title, className }: CodeBlockProps) {
  return (
    <div className={cn("overflow-hidden rounded-md border border-line bg-field", className)}>
      <div className="flex min-h-9 items-center justify-between gap-3 border-b border-line pr-1.5 pl-3">
        <span className="truncate font-mono text-caption text-ink-3">{title ?? ""}</span>
        <CopyButton value={code} iconOnly label="Copy code" />
      </div>
      <pre
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must take focus so a keyboard can scroll it
        tabIndex={0}
        className={cn(
          "m-0 overflow-x-auto px-3 py-2.5 font-mono text-meta leading-6 text-ink focus-visible:-outline-offset-2",
        )}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
