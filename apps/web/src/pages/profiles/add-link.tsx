import type { ReactNode } from "react";

/**
 * The one way to add to a list on a profile: "Add another" as a text link. The noun is read out
 * but not shown, because the list above it already says what it holds.
 */
export function AddLink({
  noun,
  first,
  disabled,
  onClick,
}: {
  noun: string;
  /** The list is empty, so the link says "Add" rather than "Add another". */
  first: boolean;
  disabled: boolean | undefined;
  onClick: () => void;
}): ReactNode {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="mt-1 inline-flex min-h-control items-center rounded-xs text-ui text-accent-text underline decoration-accent-text/40 underline-offset-2 hover:decoration-accent-text focus-visible:-outline-offset-2 disabled:cursor-not-allowed disabled:text-ink-3 disabled:no-underline"
    >
      {first ? "Add" : "Add another"} <span className="sr-only">{noun}</span>
    </button>
  );
}
