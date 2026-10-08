import { Check } from "lucide-react";
import {
  Fragment,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { cn } from "../../lib/cn.js";

export interface MenuItem {
  id: string;
  label: ReactNode;
  description?: ReactNode;
  /** Sets the description in mono, for an email address or other identifier. */
  descriptionMono?: boolean;
  icon?: ReactNode;
  /**
   * Set on items that choose one of several, such as a profile: true or false shows a check and
   * announces which is current. Leave it out on plain actions.
   */
  selected?: boolean;
  disabled?: boolean;
  destructive?: boolean;
  /** Draws a hairline above this item, to group it apart from the ones before. */
  separatorBefore?: boolean;
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
  /** Heading shown above the items. */
  heading?: string;
  className?: string | undefined;
  panelClassName?: string | undefined;
}

/**
 * A button that opens a short list of actions. Arrow keys move, Home and End jump, a letter
 * jumps to the next label starting with it, Escape closes and returns focus to the button.
 */
export function Menu({
  items,
  trigger,
  align = "start",
  heading,
  className,
  panelClassName,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const id = useId();
  const [flipped, setFlipped] = useState(false);

  // A panel that would leave the screen swaps sides before it paints, so a right-aligned menu
  // on a trigger near the left edge stays readable.
  useLayoutEffect(() => {
    if (!open) {
      setFlipped(false);
      return;
    }
    const rect = panelRef.current?.getBoundingClientRect();
    if (!rect) return;
    const gutter = 16;
    const spills = align === "end" ? rect.left < gutter : rect.right > window.innerWidth - gutter;
    setFlipped(spills);
  }, [open, align]);

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
            "absolute z-30 mt-1 min-w-full max-w-[calc(100vw-2rem)] rounded-lg border border-line-popover bg-popover p-1 shadow-pop",
            (align === "end") !== flipped ? "right-0" : "left-0",
            panelClassName,
          )}
        >
          {heading ? <p className="px-2.5 pt-1.5 pb-1 text-caption text-ink-3">{heading}</p> : null}
          {items.map((item) => (
            <Fragment key={item.id}>
              {item.separatorBefore ? <hr className="mx-1 my-1 border-line-popover" /> : null}
              <button
                type="button"
                {...(item.selected === undefined
                  ? { role: "menuitem" }
                  : { role: "menuitemradio", "aria-checked": item.selected })}
                disabled={item.disabled}
                tabIndex={-1}
                onClick={() => {
                  close(true);
                  item.onSelect();
                }}
                className={cn(
                  "flex min-h-control w-full items-center gap-2.5 rounded-sm px-2.5 py-1.5 text-left text-ui hover:bg-popover-hover focus-visible:bg-popover-hover focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4",
                  item.destructive ? "text-danger-text" : "text-ink",
                )}
              >
                {item.icon ? <span className="text-ink-3">{item.icon}</span> : null}
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate">{item.label}</span>
                  {item.description ? (
                    <span
                      className={cn(
                        "truncate text-meta text-ink-3",
                        item.descriptionMono && "font-mono text-caption",
                      )}
                    >
                      {item.description}
                    </span>
                  ) : null}
                </span>
                {item.selected ? <Check aria-hidden="true" className="text-accent-text" /> : null}
              </button>
            </Fragment>
          ))}{" "}
        </div>
      ) : null}
    </div>
  );
}
