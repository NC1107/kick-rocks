import { describe, expect, it } from "vitest";
import { canTransition, isTerminalStatus, nextStatuses, RequestStatus } from "./request-status.js";

describe("request status machine", () => {
  it("follows the happy path", () => {
    expect(canTransition("draft", "queued")).toBe(true);
    expect(canTransition("queued", "sent")).toBe(true);
    expect(canTransition("sent", "awaiting_reply")).toBe(true);
    expect(canTransition("awaiting_reply", "confirmed")).toBe(true);
  });

  it("re-queues bounces and follow-ups", () => {
    expect(canTransition("sent", "bounced")).toBe(true);
    expect(canTransition("bounced", "queued")).toBe(true);
    expect(canTransition("awaiting_reply", "no_response")).toBe(true);
    expect(canTransition("no_response", "follow_up_due")).toBe(true);
    expect(canTransition("follow_up_due", "queued")).toBe(true);
  });

  it("never leaves a terminal state", () => {
    for (const status of RequestStatus.options.filter(isTerminalStatus)) {
      expect(nextStatuses(status)).toEqual([]);
    }
  });

  it("rejects skipping steps", () => {
    expect(canTransition("draft", "confirmed")).toBe(false);
    expect(canTransition("queued", "awaiting_reply")).toBe(false);
  });

  it("lets every non-terminal state be cancelled", () => {
    for (const status of RequestStatus.options) {
      if (isTerminalStatus(status)) continue;
      expect(canTransition(status, "cancelled")).toBe(true);
    }
  });
});
