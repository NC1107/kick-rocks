import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router";

/** Lazy pages set their title a beat after the route changes, so wait for it to settle. */
const SETTLE_MS = 150;

/**
 * Speaks the new page title after a client-side navigation. A link click leaves focus where it
 * was and the page never reloads, so without this a screen reader says nothing about the change.
 */
export function RouteAnnouncer() {
  const { pathname } = useLocation();
  const [message, setMessage] = useState("");
  const announcedPath = useRef(pathname);

  useEffect(() => {
    if (announcedPath.current === pathname) return;
    announcedPath.current = pathname;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        observer.disconnect();
        setMessage(document.title);
      }, SETTLE_MS);
    };
    const observer = new MutationObserver(settle);
    const title = document.querySelector("title");
    if (title) observer.observe(title, { childList: true, characterData: true, subtree: true });
    settle();

    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [pathname]);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only">
      {message}
    </div>
  );
}
