import type { Clock } from "../core/clock.js";

/** Midday UTC, so a date derived from it is the same day in every timezone a developer uses. */
export const DEFAULT_TEST_NOW = "2026-10-07T12:00:00.000Z";

/** A clock that only moves when a test says so. */
export class FakeClock implements Clock {
  private current: Date;

  constructor(start: Date | string = DEFAULT_TEST_NOW) {
    this.current = new Date(start);
  }

  now(): Date {
    return new Date(this.current);
  }

  advance(ms: number): void {
    this.current = new Date(this.current.getTime() + ms);
  }

  set(time: Date | string): void {
    this.current = new Date(time);
  }
}

export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
