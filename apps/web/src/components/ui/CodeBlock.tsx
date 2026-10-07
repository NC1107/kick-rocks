import { cn } from "../../lib/cn.js";
import { CopyButton } from "./CopyButton.js";

export interface CodeBlockProps {
  code: string;
  /** Shown in the header, such as "bash" or "claude_desktop_config.json". */
  title?: string;
  /** Wrap long lines instead of scrolling sideways. Off for commands, which should stay one line. */
  wrap?: boolean;
  className?: string;
}

/** A command or config the person will copy. The copy button is always there. */
export function CodeBlock({ code, title, wrap = false, className }: CodeBlockProps) {
  return (
    <div className={cn("overflow-hidden rounded-md border border-line bg-sunken", className)}>
      <div className="flex min-h-9 items-center justify-between gap-3 border-b border-line pr-1.5 pl-3">
        <span className="truncate text-xs text-ink-muted">{title ?? ""}</span>
        <CopyButton value={code} iconOnly label="Copy code" />
      </div>
      <pre
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scroll container must take focus so a keyboard can scroll it
        tabIndex={0}
        className={cn(
          "m-0 px-3 py-2.5 font-mono text-sm leading-6 text-ink focus-visible:-outline-offset-2",
          wrap ? "whitespace-pre-wrap break-words" : "overflow-x-auto",
        )}
      >
        <code>{code}</code>
      </pre>
    </div>
  );
}
