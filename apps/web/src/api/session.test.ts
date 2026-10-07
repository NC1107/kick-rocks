import type { ReviewQueue } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { reviewCount } from "./session.js";

describe("reviewCount", () => {
  it("adds every tab: blocked tasks, pending matches, verifications, failed tasks, and messages", () => {
    const queue = {
      blockedTasks: [{}, {}],
      matches: [{ decision: "pending" }, { decision: "mine" }, { decision: "pending" }],
      verifications: [{}],
      failedTasks: [{}, {}, {}],
      agentTasks: [{}, {}],
      messages: [{}],
    } as unknown as ReviewQueue;
    expect(reviewCount(queue)).toBe(2 + 2 + 1 + 3 + 2 + 1);
  });

  it("is zero for an empty queue", () => {
    expect(
      reviewCount({
        blockedTasks: [],
        matches: [],
        verifications: [],
        failedTasks: [],
        agentTasks: [],
        messages: [],
      }),
    ).toBe(0);
  });
});
