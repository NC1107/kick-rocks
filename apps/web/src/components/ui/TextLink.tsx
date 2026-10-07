import { ExternalLink } from "lucide-react";
import type { ComponentProps } from "react";
import { Link, type LinkProps } from "react-router";
import { cn } from "../../lib/cn.js";

const LINK_CLASS =
  "rounded-xs text-accent-text underline decoration-accent-text/40 underline-offset-2 hover:decoration-accent-text";

export function TextLink({ className, ...rest }: LinkProps) {
  return <Link className={cn(LINK_CLASS, className)} {...rest} />;
}

/** A link to another site: opens in a new tab and says so, because leaving the app is a surprise. */
export function ExternalLinkText({ className, children, ...rest }: ComponentProps<"a">) {
  return (
    <a target="_blank" rel="noopener noreferrer" className={cn(LINK_CLASS, className)} {...rest}>
      {children}
      <ExternalLink
        aria-hidden="true"
        className="ml-1 inline-block size-3 shrink-0 align-[-0.1em]"
      />
      <span className="sr-only">(opens in a new tab)</span>
    </a>
  );
}
