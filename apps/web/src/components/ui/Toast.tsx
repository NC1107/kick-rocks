import { CircleAlert, CircleCheck, Info, X } from "lucide-react";
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
import { IconButton } from "./IconButton.js";

/** A toast confirms or notes something. Failures and warnings stay on the thing that has them. */
export type ToastIntent = "info" | "success";

export interface ToastOptions {
  intent?: ToastIntent;
  title: string;
  description?: string | undefined;
  /** Milliseconds before it goes away. 0 keeps it until dismissed. */
  durationMs?: number;
}

// "danger" exists only for the deprecated error shim and goes away with it.
type ItemIntent = ToastIntent | "danger";

interface ToastItem {
  id: number;
  intent: ItemIntent;
  title: string;
  description: string | undefined;
  durationMs: number;
}

interface ToastApi {
  toast: (options: ToastOptions) => void;
  success: (title: string, description?: string) => void;
  /**
   * @deprecated Errors never toast. Put the message on the field, row, or callout that failed.
   * Each screen drops its calls in phase 2, and toast.test.ts only lets the count go down.
   */
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_MS = 5000;
const MAX_VISIBLE = 4;

const ICONS = {
  info: Info,
  success: CircleCheck,
  danger: CircleAlert,
} as const;

const ITEM_TONE = { info: "neutral", success: "positive", danger: "danger" } as const;

/**
 * Wrap the app once. A toast confirms something the person just did, so name the result with the
 * same verb as the button that caused it: "Delete" produces "Deleted", never "Success". A failure
 * belongs on the thing that failed, so there is no error or warning intent.
 * Toasts sit bottom-left of the content on wide screens and under the top bar on phones, because
 * the decision footers and page actions that pin to the bottom-right and bottom edge must stay
 * reachable for the whole life of a toast.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [announcement, setAnnouncement] = useState<{ polite: string; assertive: string }>({
    polite: "",
    assertive: "",
  });
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setItems((current) => current.filter((item) => item.id !== id));
  }, []);

  const api = useMemo<ToastApi>(() => {
    const push = (intent: ItemIntent, options: Omit<ToastOptions, "intent">) => {
      const item: ToastItem = {
        id: nextId.current++,
        intent,
        title: options.title,
        description: options.description,
        durationMs: options.durationMs ?? DEFAULT_MS,
      };
      setItems((current) => [...current, item].slice(-MAX_VISIBLE));
      const text = options.description ? `${options.title}. ${options.description}` : options.title;
      setAnnouncement(
        intent === "danger" ? { polite: "", assertive: text } : { polite: text, assertive: "" },
      );
    };
    return {
      toast: (options) => push(options.intent ?? "info", options),
      success: (title, description) => push("success", { title, description }),
      error: (title, description) => push("danger", { title, description }),
      info: (title, description) => push("info", { title, description }),
    };
  }, []);

  return (
    <ToastContext value={api}>
      {children}
      {/* Live regions announce only text that changes after they are mounted, so these two stay mounted. */}
      <div aria-live="polite" className="sr-only">
        {announcement.polite}
      </div>
      <div aria-live="assertive" className="sr-only">
        {announcement.assertive}
      </div>
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-0 top-(--kr-bar-h) z-50 flex flex-col items-stretch gap-2 p-4 sm:inset-x-auto sm:top-auto sm:bottom-0 sm:left-54 sm:w-96"
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
      className="pointer-events-auto flex animate-rise items-start gap-3 rounded-lg border border-tone-line bg-popover py-2 pr-2 pl-3 shadow-pop"
    >
      {/* The icon, the first line of text, and the dismiss button share one center line, on a phone too. */}
      <span className="flex h-(--kr-control-sm) shrink-0 items-center">
        <Icon aria-hidden="true" className="size-4 text-tone-dot" />
      </span>
      <div className="min-w-0 flex-1 pt-[calc((var(--kr-control-sm)-1.25rem)/2)] pb-1.5">
        <p className="text-ui font-medium text-ink">{item.title}</p>
        {item.description ? (
          <p className="mt-0.5 text-meta text-ink-2">{item.description}</p>
        ) : null}
      </div>
      <IconButton label="Dismiss" size="sm" onClick={() => onDismiss(item.id)}>
        <X />
      </IconButton>
    </div>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast needs a <ToastProvider> above it");
  return api;
}
