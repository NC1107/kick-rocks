import { cn } from "../../lib/cn.js";

/**
 * The mark is a pebble caught mid-kick. It and the name are the only playful things in the app:
 * everything else is plain on purpose, because this tool handles people's identities.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7 shrink-0", className)}>
      <rect width="32" height="32" rx="8" className="fill-accent" />
      <path
        d="M12.5 13 17.5 8.5 23.5 11 25.5 17.5 21.5 23.5 14.5 23 10 18.5Z"
        strokeLinejoin="round"
        strokeWidth="1.6"
        className="fill-accent-ink stroke-accent-ink"
      />
      <path
        d="M17.5 8.5 19 15.5 25.5 17.5M19 15.5 14.5 23"
        fill="none"
        strokeWidth="1.2"
        className="stroke-accent"
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity=".45"
      />
      <path
        d="M4.5 14h4.5M3.5 18.5h5.5M5.5 23h3.5"
        className="stroke-accent-ink"
        strokeWidth="1.8"
        strokeLinecap="round"
        opacity=".65"
      />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      <span className="text-xl font-bold tracking-tight text-ink">Kick Rocks</span>
    </span>
  );
}
