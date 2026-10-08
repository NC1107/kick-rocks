import { describe, expect, it } from "vitest";
import {
  CheckArgs,
  CheckRecordArgs,
  ClickArgs,
  fieldOfPlaceholder,
  ReportArgs,
  SelectArgs,
  SnapshotArgs,
  TOOL_NAMES,
  TypeArgs,
  toolSpecsFor,
  WaitArgs,
} from "./tools.js";

const FIELDS = ["first_name", "last_name", "city", "state"];
const TOOL_SPECS = toolSpecsFor({ fieldNames: FIELDS, purpose: "remove" });
const SCAN_SPECS = toolSpecsFor({ fieldNames: FIELDS, purpose: "scan" });

function fieldEnum(specs: typeof TOOL_SPECS, name: string): string[] {
  const spec = specs.find((candidate) => candidate.name === name);
  if (!spec) throw new Error(`no ${name} tool`);
  return (spec.parameters as { properties: { field: { enum: string[] } } }).properties.field.enum;
}

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

  it("limits the type and select tools to this task's fields", () => {
    const field = typeProperties().field as { enum: string[] };
    expect(field.enum).toEqual(FIELDS);
    expect(fieldEnum(TOOL_SPECS, "select")).toEqual(FIELDS);
    expect(field.enum).not.toContain("phone");
  });

  it("falls back to every profile field when the task has none, so the schema stays valid", () => {
    const bare = toolSpecsFor({ fieldNames: [], purpose: "remove" });
    expect(fieldEnum(bare, "type")).toContain("first_name");
  });

  it("gives only a scan the check_record tool, before report", () => {
    expect(TOOL_SPECS.map((spec) => spec.name)).not.toContain("check_record");
    expect(SCAN_SPECS.map((spec) => spec.name)).toEqual([
      ...TOOL_NAMES.filter((name) => name !== "report"),
      "check_record",
      "report",
    ]);
  });

  it("asks a scan to finish with records and a removal with a result", () => {
    const scan = SCAN_SPECS.find((spec) => spec.name === "report");
    const removal = TOOL_SPECS.find((spec) => spec.name === "report");
    if (!scan || !removal) throw new Error("no report tool");
    expect(scan.description).toContain(
      "For a scan: status complete and records, the links of the records that fit, or [] when none fits. The program fills in each record's details.",
    );
    const scanProperties = (scan.parameters as { properties: Record<string, unknown> }).properties;
    expect(scanProperties.records).toMatchObject({ type: "array", items: { type: "string" } });
    expect(scanProperties).not.toHaveProperty("result");
    const removalProperties = (removal.parameters as { properties: Record<string, unknown> })
      .properties;
    expect(removalProperties).toHaveProperty("result");
    expect(removalProperties).not.toHaveProperty("records");
    expect(removal.description).toContain("status complete needs result in the exact shape");
  });

  it("tells navigate that a path on the current site works", () => {
    const navigate = TOOL_SPECS.find((spec) => spec.name === "navigate");
    expect(navigate?.description).toContain("A path starting with / opens that page");
  });

  it("says in the report tool what each blocked reason means", () => {
    const report = TOOL_SPECS.find((spec) => spec.name === "report");
    expect(report?.description).toContain("phone_verification: the site asks for a phone number");
    expect(report?.description).toContain("id_upload: it asks for an ID or a document");
    expect(report?.description).toContain("login_required: an account or sign-in");
    expect(report?.description).toContain("email_verification: a code or link sent by email");
    expect(report?.description).toContain("unknown: anything else, naming what it needs");
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
    for (const part of [0, -1, 1.5, "abc", "", 101]) {
      expect(SnapshotArgs.safeParse({ part }).success, String(part)).toBe(false);
    }
  });

  it("takes a part sent as text, and null as no part", () => {
    expect(SnapshotArgs.parse({ part: "2" }).part).toBe(2);
    expect(SnapshotArgs.parse({ part: null }).part).toBeNull();
  });

  it("selects by field or by option, and by the field when both are sent", () => {
    expect(SelectArgs.safeParse({ ref: "e1", field: "state" }).success).toBe(true);
    expect(SelectArgs.safeParse({ ref: "e1", option: "Texas" }).success).toBe(true);
    expect(SelectArgs.safeParse({ ref: "e1" }).success).toBe(false);
    expect(SelectArgs.parse({ ref: "e1", field: "state", option: "Texas" })).toEqual({
      ref: "e1",
      field: "state",
    });
  });

  it("takes null or an empty string for the option or the field a model has none of", () => {
    expect(SelectArgs.parse({ ref: "e1", field: null, option: "Texas" })).toEqual({
      ref: "e1",
      option: "Texas",
    });
    expect(SelectArgs.parse({ ref: "e1", field: "", option: "Texas" })).toEqual({
      ref: "e1",
      option: "Texas",
    });
    expect(SelectArgs.parse({ ref: "e1", field: "state", option: "" })).toEqual({
      ref: "e1",
      field: "state",
    });
    expect(SelectArgs.safeParse({ ref: "e1", field: null, option: null }).success).toBe(false);
  });

  it("reads an option written as a field's placeholder as that field", () => {
    expect(fieldOfPlaceholder("{{state}}")).toBe("state");
    expect(fieldOfPlaceholder(" {{birth_year}} ")).toBe("birth_year");
    expect(fieldOfPlaceholder("{{nonsense}}")).toBeUndefined();
    expect(fieldOfPlaceholder("Texas {{state}}")).toBeUndefined();
    expect(fieldOfPlaceholder(undefined)).toBeUndefined();
  });

  it("reads a ref of an empty string or none as no ref", () => {
    for (const ref of ["", " ", "none", "None", "null"]) {
      expect(CheckRecordArgs.parse({ ref }).ref).toBeUndefined();
    }
    expect(CheckRecordArgs.parse({ ref: "e12" }).ref).toBe("e12");
  });

  it("checks a record by the ref of its link, or by none for the page being read", () => {
    expect(CheckRecordArgs.safeParse({}).success).toBe(true);
    expect(CheckRecordArgs.safeParse({ ref: null }).success).toBe(true);
    expect(CheckRecordArgs.safeParse({ ref: "e4" }).success).toBe(true);
    expect(CheckRecordArgs.safeParse({ ref: "#card" }).success).toBe(false);
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

  it("takes a scan's records as a list of strings, a lone string as one record, and null as none given", () => {
    expect(ReportArgs.parse({ status: "complete", records: ["/profile/a", "e12"] })).toMatchObject({
      records: ["/profile/a", "e12"],
    });
    expect(ReportArgs.parse({ status: "complete", records: "/profile/a" })).toMatchObject({
      records: ["/profile/a"],
    });
    expect(ReportArgs.parse({ status: "complete", records: [] })).toMatchObject({ records: [] });
    expect(ReportArgs.parse({ status: "complete", records: null })).toEqual({ status: "complete" });
    expect(ReportArgs.parse({ status: "complete" })).toEqual({ status: "complete" });
    expect(ReportArgs.safeParse({ status: "complete", records: [{ url: "x" }] }).success).toBe(
      false,
    );
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
