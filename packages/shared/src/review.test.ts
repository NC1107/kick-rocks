import { describe, expect, it } from "vitest";
import { SkipReason, TargetOutcome } from "./campaigns.js";
import { MatchDecisionBody, ReviewQueue } from "./review.js";

describe("MatchDecisionBody", () => {
  it("asks for both rights unless the person chose", () => {
    expect(MatchDecisionBody.parse({ decision: "mine" }).rights).toEqual(["opt_out", "delete"]);
    expect(MatchDecisionBody.parse({ decision: "mine", rights: ["opt_out"] }).rights).toEqual([
      "opt_out",
    ]);
  });

  it("rejects no rights and repeated ones", () => {
    expect(MatchDecisionBody.safeParse({ decision: "mine", rights: [] }).success).toBe(false);
    expect(
      MatchDecisionBody.safeParse({ decision: "mine", rights: ["delete", "delete"] }).success,
    ).toBe(false);
    expect(MatchDecisionBody.safeParse({ decision: "maybe" }).success).toBe(false);
  });
});

describe("ReviewQueue", () => {
  it("lists what waits on a person, including brokers that asked for more and tasks that failed", () => {
    expect(Object.keys(ReviewQueue.shape).sort()).toEqual([
      "blockedTasks",
      "failedTasks",
      "matches",
      "messages",
      "verifications",
    ]);
    expect(
      ReviewQueue.parse({
        blockedTasks: [],
        matches: [],
        verifications: [],
        failedTasks: [],
        messages: [],
      }).verifications,
    ).toEqual([]);
  });
});

describe("campaign outcomes", () => {
  it("can say why a target was left out, in a sentence", () => {
    expect([...SkipReason.options]).toEqual([
      "already_active",
      "no_contact_method",
      "scan_in_progress",
      "no_mailbox",
      "already_confirmed",
      "unsupported_channel",
      "covered_by_platform",
    ]);
    const outcome = {
      targetId: "t",
      targetName: "T",
      outcome: "skipped",
      requestId: null,
      scanId: null,
      reason: "covered_by_platform",
      detail: "California's DROP handles registered brokers for California residents.",
    };
    expect(TargetOutcome.parse(outcome)).toEqual(outcome);
    expect(TargetOutcome.safeParse({ ...outcome, detail: undefined }).success).toBe(false);
  });
});
