import { describe, expect, it } from "vitest";
import {
  canTransition,
  isActiveStatus,
  isTerminalStatus,
  nextStatuses,
  RequestActor,
  RequestStatus,
} from "./requests.js";

const system = { actor: "system" } as const;
const user = { actor: "user" } as const;

describe("request status machine", () => {
  it("follows the happy path", () => {
    expect(canTransition("draft", "queued", system)).toBe(true);
    expect(canTransition("queued", "sent", system)).toBe(true);
    expect(canTransition("sent", "awaiting_reply", system)).toBe(true);
    expect(canTransition("awaiting_reply", "confirmed", system)).toBe(true);
  });

  it("re-queues bounces and follow-ups", () => {
    expect(canTransition("sent", "bounced", system)).toBe(true);
    expect(canTransition("bounced", "queued", system)).toBe(true);
    expect(canTransition("awaiting_reply", "no_response", system)).toBe(true);
    expect(canTransition("no_response", "follow_up_due", system)).toBe(true);
    expect(canTransition("follow_up_due", "queued", system)).toBe(true);
  });

  it("lets a request switch channel while awaiting a reply", () => {
    expect(canTransition("awaiting_reply", "queued", system)).toBe(true);
  });

  it("hands verification to a human and back", () => {
    expect(canTransition("awaiting_reply", "needs_verification", system)).toBe(true);
    expect(canTransition("needs_verification", "sent", system)).toBe(true);
  });

  it("allows appealing a rejection", () => {
    expect(canTransition("rejected", "queued", system)).toBe(true);
  });

  it("rejects skipping steps", () => {
    expect(canTransition("draft", "confirmed", system)).toBe(false);
    expect(canTransition("queued", "awaiting_reply", system)).toBe(false);
    expect(canTransition("sent", "confirmed", system)).toBe(false);
  });

  it("never lets a non-user actor force an outcome", () => {
    for (const actor of ["system", "worker", "agent"] as const) {
      expect(canTransition("queued", "confirmed", { actor })).toBe(false);
      expect(canTransition("sent", "no_record", { actor })).toBe(false);
      expect(canTransition("needs_verification", "rejected", { actor })).toBe(false);
    }
  });

  it("lets a user force a closed outcome from any non-terminal status", () => {
    const outcomes = ["confirmed", "no_record", "rejected", "cancelled"] as const;
    for (const from of RequestStatus.options) {
      if (isTerminalStatus(from)) continue;
      for (const to of outcomes) {
        expect(canTransition(from, to, user), `${from} -> ${to}`).toBe(from !== to);
      }
    }
  });

  it("does not let a user force anything but a closed outcome", () => {
    expect(canTransition("draft", "sent", user)).toBe(false);
    expect(canTransition("queued", "awaiting_reply", user)).toBe(false);
    expect(canTransition("sent", "queued", user)).toBe(false);
  });

  it("never leaves a terminal state, for any actor", () => {
    for (const actor of RequestActor.options) {
      for (const status of RequestStatus.options.filter(isTerminalStatus)) {
        expect(nextStatuses(status, { actor })).toEqual([]);
      }
    }
  });

  it("never transitions to itself", () => {
    for (const actor of RequestActor.options) {
      for (const status of RequestStatus.options) {
        expect(canTransition(status, status, { actor })).toBe(false);
      }
    }
  });

  it("lets every non-terminal state be cancelled", () => {
    for (const status of RequestStatus.options) {
      if (isTerminalStatus(status)) continue;
      expect(canTransition(status, "cancelled", system)).toBe(true);
    }
  });
});

describe("nextStatuses", () => {
  it("lists what an actor may move to", () => {
    expect(nextStatuses("sent", system)).toEqual(["awaiting_reply", "bounced", "cancelled"]);
    expect(nextStatuses("sent", user)).toEqual([
      "awaiting_reply",
      "confirmed",
      "rejected",
      "no_record",
      "bounced",
      "cancelled",
    ]);
  });
});

describe("isActiveStatus", () => {
  it("treats closed outcomes as inactive", () => {
    for (const status of ["confirmed", "no_record", "cancelled", "rejected"] as const) {
      expect(isActiveStatus(status)).toBe(false);
    }
    for (const status of [
      "draft",
      "queued",
      "sent",
      "awaiting_reply",
      "needs_verification",
      "bounced",
      "no_response",
      "follow_up_due",
    ] as const) {
      expect(isActiveStatus(status)).toBe(true);
    }
  });
});
