import { describe, expect, it } from "vitest";
import { packageVersion } from "./version.js";

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
