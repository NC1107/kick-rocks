import { useSyncExternalStore } from "react";

const WIDE = "(min-width: 1024px)";

/**
 * Whether the screen is wide enough for tables. The sidebar takes 216px from the viewport, so a
 * table needs this much room before its columns stop crowding, and the app's lists share the rule.
 */
export function useWide(): boolean {
  return useSyncExternalStore(
    (notify) => {
      const query = window.matchMedia(WIDE);
      query.addEventListener("change", notify);
      return () => query.removeEventListener("change", notify);
    },
    () => window.matchMedia(WIDE).matches,
    () => true,
  );
}
