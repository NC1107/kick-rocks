import { describe, expect, it } from "vitest";
import {
  PROFILE_EXPORT_FORMAT,
  ProfileExport,
  profileExportFileName,
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

describe("profileExportFileName", () => {
  it("names the file for the profile and the day", () => {
    expect(profileExportFileName("Riley O'Sample Jr.", "2026-10-07T12:00:00.000Z")).toBe(
      "kickrocks-riley-o-sample-jr-2026-10-07.json",
    );
  });

  it("falls back when the name has no letters or digits, and cuts a long one", () => {
    expect(profileExportFileName("***", "2026-10-07T00:00:00.000Z")).toBe(
      "kickrocks-profile-2026-10-07.json",
    );
    expect(profileExportFileName("a".repeat(100), "2026-10-07T00:00:00.000Z")).toBe(
      `kickrocks-${"a".repeat(40)}-2026-10-07.json`,
    );
  });
});

describe("ProfileExport", () => {
  it("names its format so a file can be recognised later", () => {
    expect(ProfileExport.shape.format.value).toBe(PROFILE_EXPORT_FORMAT);
  });
});
