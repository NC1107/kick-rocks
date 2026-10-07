import type { ReviewQueue } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { reviewCount } from "./session.js";

describe("reviewCount", () => {
  it("adds blocked tasks, pending matches, and unclassified messages", () => {
    const queue = {
      blockedTasks: [{}, {}],
      matches: [{ decision: "pending" }, { decision: "mine" }, { decision: "pending" }],
      messages: [{}],
    } as unknown as ReviewQueue;
    expect(reviewCount(queue)).toBe(2 + 2 + 1);
  });

  it("is zero for an empty queue", () => {
    expect(reviewCount({ blockedTasks: [], matches: [], messages: [] })).toBe(0);
  });
});
