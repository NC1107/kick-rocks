import { useSyncExternalStore } from "react";

const TICK_MS = 30_000;

let snapshot = Date.now();
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (listeners.size === 1) {
    snapshot = Date.now();
    timer = setInterval(() => {
      snapshot = Date.now();
      for (const notify of listeners) notify();
    }, TICK_MS);
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) clearInterval(timer);
  };
}

/**
 * One clock for the whole page. Every relative time reads the same tick, so two places that
 * describe the same moment cannot disagree by a minute.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, () => snapshot);
}
