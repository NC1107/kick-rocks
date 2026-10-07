import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
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
import { INTENT_TONE, type Intent } from "../../lib/tone.js";
import { IconButton } from "./IconButton.js";

export interface ToastOptions {
  intent?: Intent;
  title: string;
  description?: string | undefined;
  /** Milliseconds before it goes away. Errors stay longer, and 0 keeps it until dismissed. */
  durationMs?: number;
}

interface ToastItem extends Required<Pick<ToastOptions, "intent" | "title">> {
  id: number;
  description: string | undefined;
  durationMs: number;
}

interface ToastApi {
  toast: (options: ToastOptions) => void;
  success: (title: string, description?: string) => void;
  error: (title: string, description?: string) => void;
  info: (title: string, description?: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DEFAULT_MS: Record<Intent, number> = {
  info: 5000,
  success: 5000,
  warning: 8000,
  danger: 9000,
};
const MAX_VISIBLE = 4;

const ICONS = {
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
} as const;

/**
 * Wrap the app once. A toast confirms something the person just did, so name the result with the
 * same verb as the button that caused it: "Delete" produces "Deleted", never "Success". A failure
 * belongs on the thing that failed; the error helper stays for pages that have not moved there.
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
    const toast = (options: ToastOptions) => {
      const intent = options.intent ?? "info";
      const item: ToastItem = {
        id: nextId.current++,
        intent,
        title: options.title,
        description: options.description,
        durationMs: options.durationMs ?? DEFAULT_MS[intent],
      };
      setItems((current) => [...current, item].slice(-MAX_VISIBLE));
      const text = options.description ? `${options.title}. ${options.description}` : options.title;
      setAnnouncement(
        intent === "danger" ? { polite: "", assertive: text } : { polite: text, assertive: "" },
      );
    };
    return {
      toast,
      success: (title, description) => toast({ intent: "success", title, description }),
      error: (title, description) => toast({ intent: "danger", title, description }),
      info: (title, description) => toast({ intent: "info", title, description }),
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
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex flex-col items-stretch gap-2 p-4 sm:inset-x-auto sm:right-0 sm:w-96"
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
      data-tone={INTENT_TONE[item.intent]}
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
