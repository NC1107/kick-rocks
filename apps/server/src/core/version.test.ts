import { describe, expect, it } from "vitest";
import { commitDate, packageVersion } from "./version.js";

describe("packageVersion", () => {
  it("prefers the version the image build stamped", () => {
    expect(packageVersion({ KICKROCKS_VERSION: "v0.3.1-4-gabc123" })).toBe("0.3.1-4-gabc123");
  });

  it("leaves a bare commit hash alone", () => {
    expect(packageVersion({ KICKROCKS_VERSION: "71c1711-dirty" })).toBe("71c1711-dirty");
  });

  it("falls back to the package version when the stamp is blank", () => {
    expect(packageVersion({ KICKROCKS_VERSION: " " })).toBe(packageVersion({}));
  });
});

describe("commitDate", () => {
  it("returns the stamped commit date as an ISO time", () => {
    expect(commitDate({ KICKROCKS_COMMIT_DATE: "2026-10-08T14:03:00+02:00" })).toBe(
      "2026-10-08T12:03:00.000Z",
    );
  });

  it("is null when the stamp is missing, blank, or not a date", () => {
    expect(commitDate({})).toBeNull();
    expect(commitDate({ KICKROCKS_COMMIT_DATE: " " })).toBeNull();
    expect(commitDate({ KICKROCKS_COMMIT_DATE: "yesterday-ish" })).toBeNull();
  });
});
