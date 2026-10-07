import { Check } from "lucide-react";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/cn.js";

export interface MenuItem {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  /** Shows a check and uses the radio role: for choosing one of several, such as a profile. */
  selected?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  onSelect: () => void;
}

export interface MenuTriggerProps {
  ref: (element: HTMLButtonElement | null) => void;
  onClick: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  "aria-haspopup": "menu";
  "aria-expanded": boolean;
  "aria-controls": string;
}

export interface MenuProps {
  items: readonly MenuItem[];
  /** Renders the button that opens the menu. Spread the props onto it. */
  trigger: (props: MenuTriggerProps, open: boolean) => ReactNode;
  /** Which edge of the trigger the list lines up with. */
  align?: "start" | "end";
  /** Set when the items choose one of several, so assistive tech announces which is current. */
  choice?: boolean;
  /** Heading shown above the items. */
  heading?: string;
  className?: string;
  panelClassName?: string;
}

/**
 * A button that opens a short list of actions. Arrow keys move, Home and End jump, a letter
 * jumps to the next label starting with it, Escape closes and returns focus to the button.
 */
export function Menu({
  items,
  trigger,
  align = "start",
  choice = false,
  heading,
  className,
  panelClassName,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const enabled = panelRef.current?.querySelectorAll<HTMLElement>(
      "[role^=menuitem]:not(:disabled)",
    );
    const current = panelRef.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    (current ?? enabled?.[0])?.focus();
  }, [open]);

  const focusItem = (move: (items: HTMLElement[], index: number) => HTMLElement | undefined) => {
    const nodes = Array.from(
      panelRef.current?.querySelectorAll<HTMLElement>("[role^=menuitem]:not(:disabled)") ?? [],
    );
    const index = nodes.indexOf(document.activeElement as HTMLElement);
    move(nodes, index)?.focus();
  };

  const onPanelKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem((nodes, index) => nodes[(index + 1) % nodes.length]);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem((nodes, index) => nodes[(index - 1 + nodes.length) % nodes.length]);
        break;
      case "Home":
        event.preventDefault();
        focusItem((nodes) => nodes[0]);
        break;
      case "End":
        event.preventDefault();
        focusItem((nodes) => nodes[nodes.length - 1]);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          const letter = event.key.toLowerCase();
          focusItem((nodes, index) => {
            const ordered = [...nodes.slice(index + 1), ...nodes.slice(0, index + 1)];
            return ordered.find((node) =>
              node.textContent?.trim().toLowerCase().startsWith(letter),
            );
          });
        }
    }
  };

  const triggerProps: MenuTriggerProps = {
    ref: (element) => {
      triggerRef.current = element;
    },
    onClick: () => setOpen((value) => !value),
    onKeyDown: (event) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setOpen(true);
      }
    },
    "aria-haspopup": "menu",
    "aria-expanded": open,
    "aria-controls": id,
  };

  return (
    <div ref={rootRef} className={cn("relative", className)}>
      {trigger(triggerProps, open)}
      {open ? (
        <div
          ref={panelRef}
          id={id}
          role="menu"
          aria-label={heading}
          onKeyDown={onPanelKeyDown}
          className={cn(
            "absolute z-30 mt-1 min-w-full max-w-[calc(100vw-2rem)] rounded-lg border border-line bg-raised p-1 shadow-pop",
            align === "end" ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {heading ? <p className="px-2.5 pt-1.5 pb-1 text-xs text-ink-muted">{heading}</p> : null}
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              {...(choice
                ? { role: "menuitemradio", "aria-checked": Boolean(item.selected) }
                : { role: "menuitem" })}
              disabled={item.disabled}
              tabIndex={-1}
              onClick={() => {
                close(true);
                item.onSelect();
              }}
              className={cn(
                "flex min-h-control w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-left text-base hover:bg-sunken focus-visible:bg-sunken focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4",
                item.destructive ? "text-danger" : "text-ink",
              )}
            >
              {item.icon ? <span className="text-ink-muted">{item.icon}</span> : null}
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate">{item.label}</span>
                {item.description ? (
                  <span className="truncate text-sm text-ink-muted">{item.description}</span>
                ) : null}
              </span>
              {choice && item.selected ? (
                <Check aria-hidden="true" className="text-accent" />
              ) : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
