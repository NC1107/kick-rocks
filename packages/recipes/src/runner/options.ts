import type { Pace } from "./pacing.js";

/** How long each kind of wait may take. Tests shorten them; a real run uses the defaults. */
export interface Timeouts {
  /** A step's target must show up within this. */
  stepMs: number;
  /** An optional step's target gets this long, so a missing cookie banner costs little. */
  optionalMs: number;
  navigationMs: number;
  /** After a submit, how long `outcome_when` keeps looking for a matching page. */
  outcomeSettleMs: number;
  /** How long a `captcha_checkpoint` waits for a widget to render. */
  checkpointMs: number;
  /** How long a whole-page bot check may take to clear on its own before it blocks the run. */
  challengeGraceMs: number;
  /** How long a search page may take to show its first result. */
  resultsMs: number;
  /** The most a whole run may take. */
  runMs: number;
}

export const DEFAULT_TIMEOUTS: Timeouts = {
  stepMs: 10_000,
  optionalMs: 1_500,
  navigationMs: 30_000,
  outcomeSettleMs: 2_500,
  checkpointMs: 2_000,
  challengeGraceMs: 8_000,
  resultsMs: 6_000,
  runMs: 4 * 60_000,
};

/** What a caller may tune on top of the recipe and fields every run needs. */
export interface RunnerOptions {
  /**
   * The broker's domain, which a record URL must be on. Defaults to the host of the recipe's
   * entry URL, which the server checks is on the broker's domain when it loads the recipe.
   */
  targetDomain?: string | undefined;
  /**
   * Allows a record URL on http, for a fixture site on the local machine. A real run never sets
   * this, so a record URL on anything but https is refused.
   */
  allowHttp?: boolean | undefined;
  /** Defaults to the human pace. */
  pace?: Pace | undefined;
  /** Ends the run early, as a worker that is shutting down does. */
  signal?: AbortSignal | undefined;
  timeouts?: Partial<Timeouts> | undefined;
}
