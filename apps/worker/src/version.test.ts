import { describe, expect, it } from "vitest";
import { readWorkerVersion } from "./version.js";

describe("readWorkerVersion", () => {
  it("prefers the version the image build stamped", () => {
    expect(readWorkerVersion({ KICKROCKS_VERSION: "v0.3.1-4-gabc123" })).toBe("0.3.1-4-gabc123");
  });

  it("leaves a bare commit hash alone", () => {
    expect(readWorkerVersion({ KICKROCKS_VERSION: "86104a7" })).toBe("86104a7");
  });

  it("falls back to the package version when the stamp is blank", () => {
    expect(readWorkerVersion({ KICKROCKS_VERSION: " " })).toBe(readWorkerVersion({}));
  });
});
