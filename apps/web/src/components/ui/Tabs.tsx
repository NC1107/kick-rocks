import {
  type ComponentProps,
  createContext,
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { NavLink } from "react-router";
import { cn } from "../../lib/cn.js";

interface TabsContextValue {
  value: string;
  select: (value: string) => void;
  baseId: string;
}

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabs(): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) throw new Error("Tab components must be used inside <Tabs>");
  return context;
}

export interface TabsProps {
  /** Controlled value. Omit it, and pass defaultValue, to let Tabs keep its own. */
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ value, defaultValue, onValueChange, children, className }: TabsProps) {
  const baseId = useId();
  const [inner, setInner] = useState(defaultValue ?? "");
  const current = value ?? inner;
  const select = (next: string) => {
    if (value === undefined) setInner(next);
    onValueChange?.(next);
  };
  return (
    <TabsContext value={{ value: current, select, baseId }}>
      <div className={className}>{children}</div>
    </TabsContext>
  );
}

/**
 * Left and right arrows move between tabs and select as they go, Home and End jump to the ends.
 * Only the selected tab is in the Tab order, so one Tab press passes the whole list.
 */
export function TabList({ className, style, onScroll, ...rest }: ComponentProps<"div">) {
  const ref = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState({ start: false, end: false });

  const measure = useCallback(() => {
    const strip = ref.current;
    if (!strip) return;
    const start = strip.scrollLeft > 1;
    const end = strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 1;
    setHidden((current) =>
      current.start === start && current.end === end ? current : { start, end },
    );
  }, []);

  useLayoutEffect(() => {
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [measure]);

  // A fade at an edge says there are more tabs past it, which a clipped label alone does not.
  const fade = `linear-gradient(to right, ${hidden.start ? "transparent, black 1.5rem" : "black, black"}, ${hidden.end ? "black calc(100% - 1.5rem), transparent" : "black, black"})`;

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabs = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not(:disabled)'),
    );
    const index = tabs.indexOf(document.activeElement as HTMLElement);
    if (index === -1) return;
    const last = tabs.length - 1;
    const target =
      event.key === "ArrowRight"
        ? tabs[index === last ? 0 : index + 1]
        : event.key === "ArrowLeft"
          ? tabs[index === 0 ? last : index - 1]
          : event.key === "Home"
            ? tabs[0]
            : event.key === "End"
              ? tabs[last]
              : undefined;
    if (!target) return;
    event.preventDefault();
    target.focus();
    target.click();
  };

  return (
    <div
      ref={ref}
      role="tablist"
      onKeyDown={onKeyDown}
      onScroll={(event) => {
        measure();
        onScroll?.(event);
      }}
      style={
        hidden.start || hidden.end ? { maskImage: fade, WebkitMaskImage: fade, ...style } : style
      }
      className={cn(STRIP_CLASS, className)}
      {...rest}
    />
  );
}

export interface TabProps extends Omit<ComponentProps<"button">, "value"> {
  value: string;
  /** Shown as a mono number after the label, in the label's own color and never in a chip. */
  count?: number;
}

function TabCount({ count }: { count: number }) {
  return <span className="font-mono text-meta tabular-nums">{count}</span>;
}

// The hairline is a background inside the scroll box, not a border: a border sits outside the
// padding box, so the strip's overflow clipped the pixel row where the 2px underline overlaps it
// and the active mark rendered 1px.
const STRIP_CLASS =
  "relative flex gap-1 overflow-x-auto bg-[linear-gradient(var(--kr-line),var(--kr-line))] bg-size-[100%_1px] bg-bottom bg-no-repeat";

const TAB_CLASS =
  // The focus ring sits inside the tab, because the tab strip scrolls and would clip a ring outside it.
  "inline-flex h-control shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 text-ui font-medium transition-colors duration-100 focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:text-ink-3";

export function Tab({ value, count, className, children, ...rest }: TabProps) {
  const { value: selected, select, baseId } = useTabs();
  const active = selected === value;
  const ref = useRef<HTMLButtonElement>(null);
  // The strip scrolls on a narrow screen, so a tab chosen from the address must be brought into view.
  useEffect(() => {
    if (active) ref.current?.scrollIntoView?.({ block: "nearest", inline: "center" });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      role="tab"
      id={`${baseId}-tab-${value}`}
      aria-selected={active}
      aria-controls={`${baseId}-panel-${value}`}
      tabIndex={active ? 0 : -1}
      onClick={() => select(value)}
      className={cn(
        TAB_CLASS,
        active ? "border-accent-fill text-ink" : "border-transparent text-ink-3 hover:text-ink-2",
        className,
      )}
      {...rest}
    >
      {children}
      {count === undefined ? null : <TabCount count={count} />}
    </button>
  );
}

export interface TabPanelProps extends Omit<ComponentProps<"div">, "value"> {
  value: string;
}

/** Only the selected panel is rendered, so a panel that fetches data does so when it is opened. */
export function TabPanel({ value, className, ...rest }: TabPanelProps) {
  const { value: selected, baseId } = useTabs();
  if (selected !== value) return null;
  return (
    <div
      role="tabpanel"
      id={`${baseId}-panel-${value}`}
      aria-labelledby={`${baseId}-tab-${value}`}
      className={cn("pt-5", className)}
      {...rest}
    />
  );
}

export interface LinkTab {
  to: string;
  label: ReactNode;
  /** Match only this exact path, so a parent route's tab is not active on its children. */
  end?: boolean;
  count?: number;
}

/**
 * Tabs that are real routes, such as /settings and /settings/agents. They are links, not an ARIA
 * tablist, so each tab is bookmarkable and the back button works.
 */
export function LinkTabs({ items, label }: { items: readonly LinkTab[]; label: string }) {
  return (
    <nav aria-label={label} className={STRIP_CLASS}>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end ?? false}
          className={({ isActive }) =>
            cn(
              TAB_CLASS,
              isActive
                ? "border-accent-fill text-ink"
                : "border-transparent text-ink-3 hover:text-ink-2",
            )
          }
        >
          {item.label}
          {item.count === undefined ? null : <TabCount count={item.count} />}
        </NavLink>
      ))}
    </nav>
  );
}
