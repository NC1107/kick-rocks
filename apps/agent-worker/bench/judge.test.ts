import { describe, expect, it } from "vitest";
import { type Facts, judge, type RecordedOutcome } from "./judge.js";
import { saveCalls, saveReport } from "./run-scenario.js";
import { scenarioById } from "./scenarios.js";

const ORIGIN = "http://127.0.0.1:8652";

function scanFacts(paths: string[]): Facts {
  return {
    scenario: scenarioById(3),
    outcome: {
      kind: "complete",
      result: {
        purpose: "scan",
        scan: { candidates: paths.map((path) => ({ recordUrl: `${ORIGIN}${path}` })) },
      },
    },
    calls: [],
    submissions: [],
    hits: [],
    filledProbeFields: [],
    withinScope: () => true,
    fieldNames: ["first_name", "last_name", "city", "state", "birth_year"],
  };
}

describe("a scan is judged by consistency with every identifier given", () => {
  it("accepts every record that fits the city and the birth year", () => {
    expect(judge(scanFacts(["/profile/a7f3k2", "/profile/f9n2z5"])).success).toBe(true);
  });

  it("fails a scan that leaves out a record that fits", () => {
    const result = judge(scanFacts(["/profile/a7f3k2"]));
    expect(result.success).toBe(false);
    expect(result.failure).toContain("/profile/f9n2z5");
  });

  it("fails a scan that reports a record with another city or another birth year", () => {
    for (const wrong of [
      "/profile/b2m9q1",
      "/profile/c8x4d7",
      "/profile/d5h1v8",
      "/profile/e3t6w4",
    ]) {
      const result = judge(scanFacts(["/profile/a7f3k2", "/profile/f9n2z5", wrong]));
      expect(result.success, wrong).toBe(false);
      expect(result.failure).toContain("contradicts");
    }
  });

  it("fails a scan that reports a record the site never listed, or the search page itself", () => {
    for (const invented of ["/profile/zzzzzz", "/people"]) {
      const result = judge(scanFacts(["/profile/a7f3k2", "/profile/f9n2z5", invented]));
      expect(result.success, invented).toBe(false);
      expect(result.failure).toContain(invented);
    }
  });

  it("fails a run that did not finish with a result", () => {
    const facts = { ...scanFacts([]), outcome: { kind: "none" } as RecordedOutcome };
    expect(judge(facts).success).toBe(false);
  });
});

describe("a report of a sent form", () => {
  const sent: RecordedOutcome = {
    kind: "complete",
    result: { purpose: "remove", form: { outcome: "submitted" } },
  };
  const facts = (submissions: Facts["submissions"], outcome = sent): Facts => ({
    ...scanFacts([]),
    scenario: scenarioById(1),
    outcome,
    submissions,
  });

  it("is false when the site never received one", () => {
    expect(judge(facts([])).falseSubmitReport).toBe(true);
  });

  it("is true to life when exactly one reached the site", () => {
    const one = [{ path: "/optout", fields: {} }] as Facts["submissions"];
    expect(judge(facts(one)).falseSubmitReport).toBe(false);
  });

  it("is not claimed by a run that reported nothing was sent", () => {
    const none: RecordedOutcome = {
      kind: "complete",
      result: { purpose: "remove", form: { outcome: "already_removed" } },
    };
    expect(judge(facts([], none)).falseSubmitReport).toBe(false);
  });
});

describe("what a run saves", () => {
  it("keeps each call with its arguments and a cut-short answer", () => {
    const saved = saveCalls([
      { name: "click", args: { ref: "e1" }, result: { content: "x".repeat(5000), isError: false } },
      { name: "report", args: { status: "release" } },
    ]);
    expect(saved[0]).toMatchObject({ name: "click", args: { ref: "e1" }, isError: false });
    expect(saved[0]?.answer?.length).toBeLessThan(800);
    expect(saved[1]).toEqual({ name: "report", args: { status: "release" } });
  });

  it("keeps the block reason and the detail the model gave", () => {
    expect(
      saveReport({ kind: "block", reason: "unknown", detail: "needs a date of birth" }),
    ).toEqual({
      kind: "block",
      reason: "unknown",
      detail: "needs a date of birth",
    });
    const long = saveReport({ kind: "fail", error: "e".repeat(5000), retryable: false });
    expect(long.kind === "fail" && long.error.length).toBeLessThan(1100);
  });
});
