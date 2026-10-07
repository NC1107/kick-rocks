/** A range in milliseconds, inclusive at both ends. */
export type Range = readonly [min: number, max: number];

/**
 * How a run behaves like a person at the keyboard. Real sites score typing rhythm and the gaps
 * between actions, so a human pace is the default for a real run and tests use an instant one.
 */
export interface Pace {
  /** Delay after each key press. A maximum of 0 fills a field in one step instead of typing. */
  typeDelayMs: Range;
  /** Chance per key press of a longer hesitation, as if looking at the screen. */
  hesitationChance: number;
  hesitationMs: Range;
  /** A pause before each click, selection, or field. */
  actionPauseMs: Range;
  /** Multiplier on the `pause` steps a recipe asks for; 0 skips them. */
  pauseScale: number;
  random: () => number;
  sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
}

/** Resolves after `ms`, or early (and quietly) when the signal aborts. */
export function sleepFor(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal?.addEventListener("abort", finish, { once: true });
  });
}

export const HUMAN_PACE: Pace = {
  typeDelayMs: [45, 130],
  hesitationChance: 0.04,
  hesitationMs: [180, 450],
  actionPauseMs: [250, 900],
  pauseScale: 1,
  random: Math.random,
  sleep: sleepFor,
};

export const INSTANT_PACE: Pace = {
  typeDelayMs: [0, 0],
  hesitationChance: 0,
  hesitationMs: [0, 0],
  actionPauseMs: [0, 0],
  pauseScale: 0,
  random: Math.random,
  sleep: sleepFor,
};

export function between(range: Range, random: () => number): number {
  const [min, max] = range;
  return Math.round(min + (max - min) * random());
}

export function typesByKey(pace: Pace): boolean {
  return pace.typeDelayMs[1] > 0;
}

/** The delay before the next key press, including the occasional hesitation. */
export function keyDelay(pace: Pace): number {
  const base = between(pace.typeDelayMs, pace.random);
  return pace.random() < pace.hesitationChance
    ? base + between(pace.hesitationMs, pace.random)
    : base;
}
