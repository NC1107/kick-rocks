import { describe, expect, it } from "vitest";
import { tellEvents } from "./fold.js";

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, seconds)).toISOString();
const event = (type: string, seconds: number) => ({ type, createdAt: at(seconds) }) as never;

describe("tellEvents", () => {
  it("drops a status change recorded beside the event that caused it", () => {
    const events = [event("sent", 0), event("status_changed", 1)];
    expect(tellEvents(events)).toEqual([events[0]]);
  });

  it("keeps a status change that stands alone", () => {
    const events = [event("sent", 0), event("status_changed", 45 * 60)];
    expect(tellEvents(events)).toEqual(events);
  });

  it("treats a cause just after the change the same as one just before", () => {
    const events = [event("status_changed", 0), event("reply_received", 30)];
    expect(tellEvents(events)).toEqual([events[1]]);
  });
});
