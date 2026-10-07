import { useEffect } from "react";

export const APP_NAME = "Kick Rocks";

/** Sets the tab title to "Page - Kick Rocks" while the page is mounted. */
export function usePageTitle(title: string | undefined): void {
  useEffect(() => {
    if (!title) return;
    const previous = document.title;
    document.title = `${title} - ${APP_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [title]);
}
