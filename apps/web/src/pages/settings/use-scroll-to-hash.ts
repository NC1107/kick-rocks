import { useEffect } from "react";
import { useLocation } from "react-router";

const SETTLE_MS = 2000;
const USER_INPUT = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * A link to a section lands on it once the sections exist, because the router does not scroll
 * on its own. Sections above the target load after the first paint and push it down, so the jump
 * repeats while the page settles and stops as soon as the person scrolls.
 */
export function useScrollToHash(ready = true) {
  const { hash } = useLocation();
  useEffect(() => {
    if (!ready || hash === "") return;
    const target = () => document.getElementById(hash.slice(1));
    const jump = () => target()?.scrollIntoView?.({ block: "start" });
    jump();
    const host = target()?.parentElement;
    if (!host || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(jump);
    observer.observe(host);
    const stop = () => observer.disconnect();
    const timer = setTimeout(stop, SETTLE_MS);
    for (const type of USER_INPUT)
      window.addEventListener(type, stop, { once: true, passive: true });
    return () => {
      clearTimeout(timer);
      stop();
      for (const type of USER_INPUT) window.removeEventListener(type, stop);
    };
  }, [hash, ready]);
}
