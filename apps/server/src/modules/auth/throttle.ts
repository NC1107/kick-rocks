import type { Clock } from "../../core/clock.js";

const FREE_FAILURES = 5;
const FIRST_LOCK_MS = 30_000;
const MAX_LOCK_MS = 15 * 60_000;
const FORGET_AFTER_MS = 60 * 60_000;
const MAX_TRACKED_KEYS = 10_000;

interface Attempts {
  failures: number;
  lockedUntil: number;
  lastFailureAt: number;
}

export type ThrottleCheck = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Slows down guessing. The first few failures from one key cost nothing, then each further failure
 * doubles the lockout up to a ceiling. A locked key is refused without being judged, so a correct
 * password sent during a lockout learns nothing and does not extend it. State lives in memory on
 * purpose: a restart clears it, which is the same as waiting out the lockout.
 */
export class LoginThrottle {
  private readonly records = new Map<string, Attempts>();

  constructor(private readonly clock: Clock) {}

  /**
   * Asks to try once, and counts the try as a failure straight away. Counting before the slow
   * password check is what stops a burst of parallel guesses from all slipping in under the limit;
   * `succeed` takes the count back when the guess was right.
   */
  attempt(key: string): ThrottleCheck {
    const now = this.clock.now().getTime();
    const record = this.records.get(key);
    if (record && now - record.lastFailureAt > FORGET_AFTER_MS) this.records.delete(key);
    const live = this.records.get(key);
    if (live && live.lockedUntil > now) {
      return { allowed: false, retryAfterSeconds: Math.ceil((live.lockedUntil - now) / 1000) };
    }
    this.recordFailure(key, now);
    return { allowed: true };
  }

  private recordFailure(key: string, now: number): void {
    this.evictStale(now);
    const failures = (this.records.get(key)?.failures ?? 0) + 1;
    const excess = failures - FREE_FAILURES;
    const lock = excess >= 0 ? Math.min(MAX_LOCK_MS, FIRST_LOCK_MS * 2 ** excess) : 0;
    this.records.set(key, { failures, lockedUntil: now + lock, lastFailureAt: now });
  }

  succeed(key: string): void {
    this.records.delete(key);
  }

  private evictStale(now: number): void {
    if (this.records.size < MAX_TRACKED_KEYS) return;
    for (const [key, record] of this.records) {
      if (now - record.lastFailureAt > FORGET_AFTER_MS) this.records.delete(key);
    }
    // Still full of live lockouts: drop the oldest entry rather than grow without bound.
    if (this.records.size >= MAX_TRACKED_KEYS) {
      const oldest = this.records.keys().next().value;
      if (oldest !== undefined) this.records.delete(oldest);
    }
  }
}
