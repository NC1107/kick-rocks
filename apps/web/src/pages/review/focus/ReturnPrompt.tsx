import type { FormOutcome } from "@kickrocks/shared";
import { useEffect } from "react";
import { Button, InlineError, Kbd } from "../../../components/ui/index.js";
import { shortcutAllowed } from "../keys.js";
import { OTHER_OUTCOMES } from "./copy.js";

export interface ReturnPromptProps {
  question: string;
  /** Offer the other ways a removal can end. Only a task tied to a request has them. */
  withOutcomes: boolean;
  busy: boolean;
  error?: string | undefined;
  onYes: () => void;
  onNotYet: () => void;
  onSkip: () => void;
  /** Reopens the page without leaving the question. */
  onOpenAgain?: (() => void) | undefined;
  onOutcome: (outcome: FormOutcome) => void;
}

/** Replaces the action bar once the person has been to the page: did it work? */
export function ReturnPrompt({
  question,
  withOutcomes,
  busy,
  error,
  onYes,
  onNotYet,
  onSkip,
  onOpenAgain,
  onOutcome,
}: ReturnPromptProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!shortcutAllowed(event) || busy) return;
      if (event.key === "y") onYes();
      else if (event.key === "n") onNotYet();
      else if (event.key === "s") onSkip();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [busy, onYes, onNotYet, onSkip]);

  return (
    <div className="flex flex-col gap-2.5">
      {error ? <InlineError>{error}</InlineError> : null}
      <p className="m-0 text-heading font-semibold text-ink">{question}</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" data-primary onClick={onYes} loading={busy}>
          Yes
        </Button>
        <Button onClick={onNotYet} disabled={busy}>
          Not yet
        </Button>
        <Button variant="ghost" onClick={onSkip} disabled={busy}>
          Skip
        </Button>
        <span className="ml-auto hidden items-center gap-1 text-caption text-ink-3 lg:inline-flex pointer-coarse:hidden">
          <Kbd>y</Kbd>
          <Kbd>n</Kbd>
          <Kbd>s</Kbd>
        </span>
      </div>
      {onOpenAgain ? (
        <button
          type="button"
          disabled={busy}
          onClick={onOpenAgain}
          className="inline-flex min-h-8 items-center self-start rounded-xs text-ui text-accent-text underline decoration-accent-text/40 underline-offset-2 disabled:text-ink-3 pointer-coarse:min-h-11"
        >
          Open again
        </button>
      ) : null}
      {withOutcomes ? (
        <p className="m-0 flex flex-wrap items-center gap-x-1 text-meta text-ink-3">
          Other:
          {OTHER_OUTCOMES.map(({ outcome, label }, index) => (
            <span key={outcome} className="inline-flex items-center gap-1">
              {index > 0 ? <span aria-hidden="true">·</span> : null}
              <button
                type="button"
                disabled={busy}
                onClick={() => onOutcome(outcome)}
                className="inline-flex min-h-8 items-center rounded-xs px-1 text-accent-text underline decoration-accent-text/40 underline-offset-2 disabled:text-ink-3 pointer-coarse:min-h-11"
              >
                {label}
              </button>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
