import { describe, expect, it } from "vitest";
import {
  PROFILE_EXPORT_FORMAT,
  ProfileExport,
  RESET_CONFIRMATION,
  ResetBody,
} from "./data-rights.js";

describe("ResetBody", () => {
  it("accepts only the exact phrase", () => {
    expect(ResetBody.safeParse({ confirm: RESET_CONFIRMATION }).success).toBe(true);
    expect(ResetBody.safeParse({ confirm: "Delete everything" }).success).toBe(false);
    expect(ResetBody.safeParse({ confirm: "" }).success).toBe(false);
    expect(ResetBody.safeParse({}).success).toBe(false);
  });
});

describe("ProfileExport", () => {
  it("names its format so a file can be recognised later", () => {
    expect(ProfileExport.shape.format.value).toBe(PROFILE_EXPORT_FORMAT);
  });
});
