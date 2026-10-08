import { describe, expect, it } from "vitest";
import {
  CheckArgs,
  ClickArgs,
  ReportArgs,
  SelectArgs,
  SnapshotArgs,
  TOOL_NAMES,
  TOOL_SPECS,
  TypeArgs,
  WaitArgs,
} from "./tools.js";

function typeProperties(): Record<string, unknown> {
  const spec = TOOL_SPECS.find((candidate) => candidate.name === "type");
  if (!spec) throw new Error("no type tool");
  return (spec.parameters as { properties: Record<string, unknown> }).properties;
}

describe("tool specs", () => {
  it("describe exactly the tools the toolbox runs, each with an object schema", () => {
    expect(TOOL_SPECS.map((spec) => spec.name)).toEqual([...TOOL_NAMES]);
    for (const spec of TOOL_SPECS) {
      expect(spec.parameters).toMatchObject({ type: "object" });
      expect(spec.description.length).toBeGreaterThan(10);
    }
  });

  it("offers no tool that takes a literal value to type", () => {
    expect(Object.keys(typeProperties())).toEqual(["ref", "field"]);
  });

  it("limits the type tool to the profile fields", () => {
    const field = typeProperties().field as { enum: string[] };
    expect(field.enum).toContain("first_name");
    expect(field.enum).toContain("record_url");
    expect(field.enum).not.toContain("password");
  });
});

describe("argument schemas", () => {
  it("accepts only refs from a snapshot", () => {
    expect(ClickArgs.safeParse({ ref: "e12" }).success).toBe(true);
    for (const ref of ["12", "e", "e1x", "#submit", "button[type=submit]", "", "e123456"]) {
      expect(ClickArgs.safeParse({ ref }).success, ref).toBe(false);
    }
  });

  it("types only a named profile field", () => {
    expect(TypeArgs.safeParse({ ref: "e1", field: "email" }).success).toBe(true);
    expect(TypeArgs.safeParse({ ref: "e1", field: "ssn" }).success).toBe(false);
    expect(TypeArgs.safeParse({ ref: "e1" }).success).toBe(false);
    expect(TypeArgs.parse({ ref: "e1", field: "email", value: "x@y.z" })).toEqual({
      ref: "e1",
      field: "email",
    });
  });

  it("reads a part of a long page by number, from 1", () => {
    expect(SnapshotArgs.safeParse({}).success).toBe(true);
    expect(SnapshotArgs.safeParse({ part: 3 }).success).toBe(true);
    for (const part of [0, -1, 1.5, "2", 101]) {
      expect(SnapshotArgs.safeParse({ part }).success, String(part)).toBe(false);
    }
  });

  it("selects by field or by option, not both and not neither", () => {
    expect(SelectArgs.safeParse({ ref: "e1", field: "state" }).success).toBe(true);
    expect(SelectArgs.safeParse({ ref: "e1", option: "Texas" }).success).toBe(true);
    expect(SelectArgs.safeParse({ ref: "e1" }).success).toBe(false);
    expect(SelectArgs.safeParse({ ref: "e1", field: "state", option: "Texas" }).success).toBe(
      false,
    );
  });

  it("defaults check to ticking and wait to two seconds, and bounds the wait", () => {
    expect(CheckArgs.parse({ ref: "e1" }).checked).toBe(true);
    expect(WaitArgs.parse({}).seconds).toBe(2);
    expect(WaitArgs.safeParse({ seconds: 11 }).success).toBe(false);
    expect(WaitArgs.safeParse({ seconds: 0 }).success).toBe(false);
  });
});

describe("report arguments", () => {
  it("takes each status with what it needs", () => {
    expect(ReportArgs.safeParse({ status: "complete", result: { purpose: "scan" } }).success).toBe(
      true,
    );
    expect(ReportArgs.safeParse({ status: "blocked", reason: "captcha" }).success).toBe(true);
    expect(ReportArgs.safeParse({ status: "failed", error: "down" }).success).toBe(true);
    expect(ReportArgs.safeParse({ status: "release" }).success).toBe(true);
  });

  it("refuses an unknown block reason, an empty error, and a recipe failure", () => {
    expect(ReportArgs.safeParse({ status: "blocked", reason: "tired" }).success).toBe(false);
    expect(ReportArgs.safeParse({ status: "failed", error: "" }).success).toBe(false);
    expect(
      ReportArgs.safeParse({ status: "failed", error: "x", failureKind: "recipe" }).success,
    ).toBe(false);
    expect(ReportArgs.safeParse({ status: "done" }).success).toBe(false);
  });

  it("defaults a failure to internal and not retryable", () => {
    expect(ReportArgs.parse({ status: "failed", error: "gave up" })).toEqual({
      status: "failed",
      error: "gave up",
      failureKind: "internal",
      retryable: false,
    });
  });
});
