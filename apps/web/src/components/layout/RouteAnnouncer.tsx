import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

/** A quiet stretch after the last DOM change, so a page that renders in steps is not cut short. */
const SETTLE_MS = 150;
/** Gap between clearing and refilling the live region, so an unchanged title is spoken again. */
const REFILL_MS = 50;
/** A page that never stops loading still gets announced, with whatever title it has by then. */
const MAX_WAIT_MS = 3000;

const isLoading = () =>
  document.querySelector("#main[aria-busy=true], #main [aria-busy=true]") !== null;

/**
 * Speaks the new page title after a client-side navigation. A link click leaves focus where it
 * was and the page never reloads, so without this a screen reader says nothing about the change.
 * Pages that fetch data show a placeholder title while aria-busy, so it waits for the real one.
 */
export function RouteAnnouncer() {
  const { pathname } = useLocation();
  const [message, setMessage] = useState("");
  const announcedPath = useRef(pathname);

  useEffect(() => {
    if (announcedPath.current === pathname) return;
    announcedPath.current = pathname;

    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    let refillTimer: ReturnType<typeof setTimeout> | undefined;

    const announce = () => {
      observer.disconnect();
      clearTimeout(settleTimer);
      clearTimeout(capTimer);
      setMessage("");
      refillTimer = setTimeout(() => setMessage(document.title), REFILL_MS);
    };
    const settle = () => {
      clearTimeout(settleTimer);
      settleTimer = setTimeout(() => {
        if (!isLoading()) announce();
      }, SETTLE_MS);
    };

    const observer = new MutationObserver(settle);
    observer.observe(document.documentElement, {
      childList: true,
      characterData: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-busy"],
    });
    const capTimer = setTimeout(announce, MAX_WAIT_MS);
    settle();

    return () => {
      observer.disconnect();
      clearTimeout(settleTimer);
      clearTimeout(refillTimer);
      clearTimeout(capTimer);
    };
  }, [pathname]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
