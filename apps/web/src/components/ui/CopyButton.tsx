import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { copyText } from "../../lib/clipboard.js";
import { Button, type ButtonVariant } from "./Button.js";
import { IconButton } from "./IconButton.js";

export interface CopyButtonProps {
  value: string;
  /** What is being copied, for the accessible name: "Copy token". */
  label?: string;
  /** An icon-only button, for tight spaces such as the corner of a code block. */
  iconOnly?: boolean;
  variant?: ButtonVariant;
  className?: string;
}

const RESET_MS = 1800;

export function CopyButton({
  value,
  label = "Copy",
  iconOnly = false,
  variant = "secondary",
  className,
}: CopyButtonProps) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const onClick = async () => {
    const ok = await copyText(value);
    setState(ok ? "copied" : "failed");
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), RESET_MS);
  };

  const shown = state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : label;
  const Icon = state === "copied" ? Check : Copy;
  const live = (
    <span role="status" className="sr-only">
      {state === "idle" ? "" : shown}
    </span>
  );

  if (iconOnly) {
    return (
      <>
        <IconButton label={shown} size="sm" variant="ghost" onClick={onClick} className={className}>
          <Icon />
        </IconButton>
        {live}
      </>
    );
  }
  return (
    <>
      <Button size="sm" variant={variant} onClick={onClick} className={className}>
        <Icon aria-hidden="true" className="size-3.5" />
        {shown}
      </Button>
      {live}
    </>
  );
}
