import {
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/cn.js";

export interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  /** Milliseconds before it shows. Focus shows it at once, so keyboard users never wait. */
  delayMs?: number;
  className?: string | undefined;
}

interface Placement {
  left: number;
  top: number;
}

const GAP = 6;
const EDGE = 8;

/**
 * Replaces the native title popup, which cannot be styled and appears on its own schedule. It
 * never carries information the page lacks: the text it shows is also the trigger's description.
 * It renders in a portal, so a table's or a dialog's overflow cannot clip it.
 */
export function Tooltip({ content, children, delayMs = 600, className }: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const show = useCallback((wait: number) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), wait);
  }, []);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(false);
    setPlacement(null);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, hide]);

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current?.getBoundingClientRect();
    const bubble = bubbleRef.current?.getBoundingClientRect();
    if (!trigger || !bubble) return;
    const below = trigger.bottom + GAP + bubble.height <= window.innerHeight - EDGE;
    const top = below ? trigger.bottom + GAP : trigger.top - GAP - bubble.height;
    const centered = trigger.left + trigger.width / 2 - bubble.width / 2;
    const left = Math.min(Math.max(EDGE, centered), window.innerWidth - bubble.width - EDGE);
    setPlacement({ left, top });
  }, [open]);

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the listeners only show a hint for the child, which keeps its own role */}
      <span
        ref={triggerRef}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => show(delayMs)}
        onMouseLeave={hide}
        onFocus={() => show(0)}
        onBlur={hide}
        onPointerDown={hide}
        className={cn("inline-flex", className)}
      >
        {children}
      </span>
      {open
        ? createPortal(
            <span
              ref={bubbleRef}
              id={id}
              role="tooltip"
              style={placement ?? { left: 0, top: 0, visibility: "hidden" }}
              className="pointer-events-none fixed z-60 max-w-64 rounded-xs border border-line-popover bg-popover px-2 py-1 text-caption text-ink shadow-pop"
            >
              {content}
            </span>,
            document.body,
          )
        : null}
    </>
  );
}
