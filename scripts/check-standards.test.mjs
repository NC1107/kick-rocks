import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findCommitViolations, findViolations, resolveRange } from "./check-standards.mjs";

const dash = "—";
const brand = ["Cla", "ude"].join("");

function scan(files) {
  return findViolations(Object.keys(files), (file) => files[file]);
}

describe("findViolations", () => {
  it("flags an em dash with file and line", () => {
    assert.deepEqual(scan({ "apps/a.ts": `ok\nbad ${dash} here` }), ["apps/a.ts:2: em dash"]);
  });

  it("ignores pinned upstream data", () => {
    assert.deepEqual(scan({ "packages/brokers/data/upstream/x.csv": `a ${dash} b` }), []);
  });

  it("flags the brand case-insensitively outside the allowlist", () => {
    const result = scan({ "apps/web/a.tsx": `${brand.toUpperCase()} code`, "docs/a.md": brand });
    assert.equal(result.length, 2);
  });

  it("allows the brand in the Anthropic provider code and tests", () => {
    assert.deepEqual(
      scan({
        "apps/agent-worker/src/config.ts": `${brand.toLowerCase()}-sonnet`,
        "apps/agent-worker/src/providers/anthropic.ts": brand,
        "apps/agent-worker/src/providers/providers.test.ts": brand,
      }),
      [],
    );
  });

  it("skips binary and unreadable files", () => {
    const result = findViolations(["a.png", "gone.ts"], (file) => {
      if (file === "gone.ts") throw new Error("missing");
      return dash;
    });
    assert.deepEqual(result, []);
  });
});

describe("findCommitViolations", () => {
  it("flags a Co-Authored-By trailer", () => {
    const message = "Fix it\n\nCo-Authored-By: Someone <a@b.c>";
    assert.deepEqual(findCommitViolations([{ sha: "abcdef1234567", message }]), [
      "commit abcdef1234: Co-Authored-By trailer",
    ]);
  });

  it('flags a "Generated with" line', () => {
    const message = "Fix it\n\nGenerated with a tool";
    assert.equal(findCommitViolations([{ sha: "abcdef1234567", message }]).length, 1);
  });

  it("passes a plain message", () => {
    assert.deepEqual(findCommitViolations([{ sha: "abc", message: "Fix the thing" }]), []);
  });
});

describe("resolveRange", () => {
  it("uses the explicit range", () => {
    assert.equal(
      resolveRange({ STANDARDS_RANGE: "a..b" }, () => false),
      "a..b",
    );
  });

  it("falls back to the head commit when the base is all zeros", () => {
    assert.equal(
      resolveRange({ STANDARDS_RANGE: `${"0".repeat(40)}..b` }, () => true),
      "HEAD^!",
    );
  });

  it("defaults to origin/main when it exists, else the head commit", () => {
    assert.equal(
      resolveRange({}, () => true),
      "origin/main..HEAD",
    );
    assert.equal(
      resolveRange({}, () => false),
      "HEAD^!",
    );
  });
});
