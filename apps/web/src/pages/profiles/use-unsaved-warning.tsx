import { useEffect, useRef } from "react";
import { type Blocker, useBlocker } from "react-router";
import { ConfirmDialog } from "../../components/ui/index.js";

export interface UnsavedChanges {
  blocker: Blocker;
  /** Lets the next navigation through, for a page that leaves on purpose right after saving or deleting. */
  allowLeaving: () => void;
}

/**
 * Stops the person walking away from edits they have not saved: the browser asks before the tab
 * closes or reloads, and the router holds an in-app move until the person says to discard. Render
 * UnsavedChangesDialog with the result.
 */
export function useUnsavedWarning(dirty: boolean): UnsavedChanges {
  const allowed = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !allowed.current && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  return {
    blocker,
    allowLeaving: () => {
      allowed.current = true;
    },
  };
}

export function UnsavedChangesDialog({ blocker }: { blocker: Blocker }) {
  return (
    <ConfirmDialog
      open={blocker.state === "blocked"}
      onClose={() => blocker.reset?.()}
      title="Leave without saving?"
      description="You changed this profile and have not saved. Leaving now throws those changes away."
      confirmLabel="Discard and leave"
      cancelLabel="Keep editing"
      destructive
      onConfirm={() => blocker.proceed?.()}
    />
  );
}
