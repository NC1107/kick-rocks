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
  /**
   * A tap opens the tooltip only when the trigger has no action of its own. A button, link or
   * menu trigger is detected and never opens it; set this for a button that does nothing but
   * stand for a status and so needs the tap to explain itself.
   */
  hintOnTap?: boolean;
}

const OVERLAY_OPEN = "kr:overlay-open";
const ACTIONABLE =
  "button, a[href], summary, input, select, textarea, [role=button], [aria-haspopup]";
// Touch browsers replay mouse events after a tap, which would show the tooltip a tap must not.
const TOUCH_ECHO_MS = 700;

/** A menu, popover, sheet or dialog calls this as it opens so no tooltip is left on top of it. */
export function announceOverlayOpen() {
  window.dispatchEvent(new Event(OVERLAY_OPEN));
}

// A tap, or an overlay handing focus back to its trigger after a tap, is not keyboard focus and must not show the tooltip.
function isKeyboardFocus(target: EventTarget): boolean {
  try {
    return (target as Element).matches(":focus-visible");
  } catch {
    return true;
  }
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
export function Tooltip({
  content,
  children,
  delayMs = 600,
  className,
  hintOnTap = false,
}: TooltipProps) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const bubbleRef = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const openRef = useRef(false);
  const touchWasOpen = useRef<boolean | null>(null);
  const lastTouchAt = useRef(Number.NEGATIVE_INFINITY);
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<Placement | null>(null);

  const show = useCallback((wait: number) => {
    clearTimeout(timer.current);
    // The tooltip would sit on top of the popup the trigger has open, and nothing else closes it again.
    if (triggerRef.current?.querySelector('[aria-expanded="true"]')) return;
    timer.current = setTimeout(() => setOpen(true), wait);
  }, []);
  const hide = useCallback(() => {
    clearTimeout(timer.current);
    setOpen(false);
    setPlacement(null);
  }, []);

  useEffect(() => () => clearTimeout(timer.current), []);
  useEffect(() => {
    window.addEventListener(OVERLAY_OPEN, hide);
    return () => window.removeEventListener(OVERLAY_OPEN, hide);
  }, [hide]);
  openRef.current = open;

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    // A finger has no pointer to leave and iOS never focuses a tapped button, so a tap elsewhere is the only way a touch user closes it.
    const onOutside = (event: PointerEvent) => {
      if (!triggerRef.current?.contains(event.target as Node)) hide();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onOutside);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onOutside);
    };
  }, [open, hide]);

  const touchEcho = () => performance.now() - lastTouchAt.current < TOUCH_ECHO_MS;

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
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: the click only toggles the hint for a touch tap, the child handles the keyboard */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the listeners only show a hint for the child, which keeps its own role */}
      <span
        ref={triggerRef}
        aria-describedby={open ? id : undefined}
        onMouseEnter={() => {
          if (!touchEcho()) show(delayMs);
        }}
        onMouseLeave={hide}
        onFocus={(event) => {
          if (isKeyboardFocus(event.target)) show(0);
        }}
        onBlur={hide}
        onPointerDown={(event) => {
          if (event.pointerType === "touch") {
            lastTouchAt.current = performance.now();
            const hasOwnAction =
              !hintOnTap && (event.target as Element).closest(ACTIONABLE) !== null;
            if (hasOwnAction) {
              touchWasOpen.current = null;
              hide();
            } else touchWasOpen.current = openRef.current;
            return;
          }
          hide();
        }}
        onClick={() => {
          const wasOpen = touchWasOpen.current;
          touchWasOpen.current = null;
          if (wasOpen === null) return;
          if (wasOpen) hide();
          else show(0);
        }}
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
