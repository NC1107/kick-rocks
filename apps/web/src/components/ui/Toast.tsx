import { CircleCheck, Info, X } from "lucide-react";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Link } from "react-router";
import { EntityLink, type EntityRef } from "./EntityLink.js";
import { IconButton } from "./IconButton.js";

/** A toast confirms or notes something. Failures and warnings stay on the thing that has them. */
export type ToastIntent = "info" | "success";

/** Where a toast leads (the thing it names, or a page with its own words), or what it undoes. */
export type ToastAction =
  | EntityRef
  | { to: string; label: string }
  | { label: string; onClick: () => void };

export interface ToastOptions {
  intent?: ToastIntent;
  title: string;
  description?: string | undefined;
  action?: ToastAction | undefined;
  /** Milliseconds before it goes away. 0 keeps it until dismissed. */
  durationMs?: number;
}

interface ToastItem {
  id: number;
  intent: ToastIntent;
  title: string;
  description: string | undefined;
  action: ToastAction | undefined;
  durationMs: number;
}

type ToastExtras = Pick<ToastOptions, "action" | "durationMs">;

interface ToastApi {
  toast: (options: ToastOptions) => void;
  success: (title: string, description?: string, extras?: ToastExtras) => void;
  info: (title: string, description?: string, extras?: ToastExtras) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_MS = 5000;
const MAX_VISIBLE = 4;

const ICONS = {
  info: Info,
  success: CircleCheck,
} as const;

const ITEM_TONE = { info: "neutral", success: "positive" } as const;

/**
 * Wrap the app once. A toast confirms something the person just did, so name the result with the
 * same verb as the button that caused it: "Delete" produces "Deleted", never "Success". A failure
 * belongs on the thing that failed, so there is no error or warning intent.
 * Toasts sit bottom-left of the content on wide screens, on the content gutter. On phones they
 * cover the top bar, because the back link below it and the decision footer pinned to the bottom
 * edge must stay reachable for the whole life of a toast. That is why a phone toast shows its
 * title on one line and leaves the description to the live region.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [announcement, setAnnouncement] = useState("");
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const api = useMemo<ToastApi>(() => {
    const push = (intent: ToastIntent, options: Omit<ToastOptions, "intent">) => {
      const item: ToastItem = {
        id: nextId.current++,
        intent,
        title: options.title,
        description: options.description,
        action: options.action,
        durationMs: options.durationMs ?? DEFAULT_MS,
      };
      setItems((current) => [...current, item].slice(-MAX_VISIBLE));
      const text = options.description ? `${options.title}. ${options.description}` : options.title;
      setAnnouncement(text);
    };
    return {
      toast: (options) => push(options.intent ?? "info", options),
      success: (title, description, extras) => push("success", { title, description, ...extras }),
      info: (title, description, extras) => push("info", { title, description, ...extras }),
    };
  }, []);

  return (
    <ToastContext value={api}>
      {children}
      {/* A live region announces only text that changes after it is mounted, so it stays mounted. */}
      <div aria-live="polite" className="sr-only">
        {announcement}
      </div>
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 top-0 z-50 flex flex-col items-stretch gap-2 px-4 pt-[max(0.5rem,env(safe-area-inset-top))] sm:inset-x-auto sm:top-auto sm:bottom-5 sm:left-[calc(13.5rem+1.25rem)] sm:w-96 sm:p-0"
      >
        {items.map((item) => (
          <ToastCard key={item.id} item={item} onDismiss={dismiss} />
        ))}
      </section>
    </ToastContext>
  );
}

function ToastCard({ item, onDismiss }: { item: ToastItem; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const Icon = ICONS[item.intent];

  useEffect(() => {
    if (paused || item.durationMs === 0) return;
    const timer = setTimeout(() => onDismiss(item.id), item.durationMs);
    return () => clearTimeout(timer);
  }, [paused, item.durationMs, item.id, onDismiss]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: hover and focus only pause the timer
    <div
      data-tone={ITEM_TONE[item.intent]}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      className="pointer-events-auto flex animate-rise items-start gap-3 rounded-lg border border-tone-line bg-popover py-2 max-sm:py-0.5 pr-2 pl-3 shadow-pop"
    >
      {/* The icon, the first line of text, and the dismiss button share one center line, on a phone too. */}
      <span className="flex h-(--kr-control-sm) shrink-0 items-center">
        <Icon aria-hidden="true" className="size-4 text-tone-dot" />
      </span>
      <div className="min-w-0 flex-1 pt-[calc((var(--kr-control-sm)-1.25rem)/2)] pb-1.5">
        <p className="text-ui font-medium text-ink max-sm:line-clamp-3">{item.title}</p>
        {item.description ? (
          <p className="mt-0.5 text-meta text-ink-2 max-sm:hidden">{item.description}</p>
        ) : null}
      </div>
      {item.action ? (
        <ToastActionLink action={item.action} onDone={() => onDismiss(item.id)} />
      ) : null}
      <IconButton label="Dismiss" size="sm" onClick={() => onDismiss(item.id)}>
        <X />
      </IconButton>
    </div>
  );
}

function ToastActionLink({ action, onDone }: { action: ToastAction; onDone: () => void }) {
  const className =
    "flex h-(--kr-control-sm) max-w-32 shrink-0 items-center truncate text-meta whitespace-nowrap";
  if ("onClick" in action) {
    return (
      <button
        type="button"
        onClick={() => {
          action.onClick();
          onDone();
        }}
        className={`${className} rounded-xs text-accent-text underline decoration-accent-text/40 underline-offset-2 focus-visible:-outline-offset-2`}
      >
        {action.label}
      </button>
    );
  }
  return "kind" in action ? (
    <EntityLink to={action} className={className} />
  ) : (
    <Link
      to={action.to}
      className={`${className} rounded-xs text-accent-text underline decoration-accent-text/40 underline-offset-2 focus-visible:-outline-offset-2`}
    >
      {action.label}
    </Link>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a <ToastProvider> above it");
  return api;
}
