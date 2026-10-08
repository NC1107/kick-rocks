import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readPinnedUpstream } from "./upstream.js";

const dirs: string[] = [];

function fixture(content: string, pinnedContent = content): string {
  const dir = mkdtempSync(join(tmpdir(), "kr-upstream-"));
  dirs.push(dir);
  writeFileSync(join(dir, "list.md"), content);
  writeFileSync(
    join(dir, "pin.json"),
    JSON.stringify({
      commit: "a".repeat(40),
      files: {
        "list.md": {
          path: "README.md",
          sha256: createHash("sha256").update(pinnedContent).digest("hex"),
        },
      },
    }),
  );
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("readPinnedUpstream", () => {
  it("returns a file that matches its pinned hash", () => {
    const dir = fixture("hello");
    expect(readPinnedUpstream("list.md", { dir, source: "pin.json" })).toBe("hello");
  });

  it("refuses a file that was edited after it was pinned", () => {
    const dir = fixture("edited", "original");
    expect(() => readPinnedUpstream("list.md", { dir, source: "pin.json" })).toThrow(
      /does not match its pinned copy/,
    );
  });

  it("refuses a file the pin does not list", () => {
    const dir = fixture("hello");
    expect(() => readPinnedUpstream("other.md", { dir, source: "pin.json" })).toThrow(/not listed/);
  });

  it("refuses a malformed pin", () => {
    const dir = fixture("hello");
    writeFileSync(join(dir, "pin.json"), JSON.stringify({ commit: "short", files: {} }));
    expect(() => readPinnedUpstream("list.md", { dir, source: "pin.json" })).toThrow();
  });

  it("accepts a plain download pinned by URL and retrieval date", () => {
    const dir = fixture("a,b");
    writeFileSync(
      join(dir, "pin.json"),
      JSON.stringify({
        url: "https://example.com/list.csv",
        retrievedAt: "2026-10-07",
        files: {
          "list.md": {
            path: "list.csv",
            sha256: createHash("sha256").update("a,b").digest("hex"),
          },
        },
      }),
    );
    expect(readPinnedUpstream("list.md", { dir, source: "pin.json" })).toBe("a,b");
  });

  it("refuses a pin that names neither a commit nor a download", () => {
    const dir = fixture("hello");
    writeFileSync(
      join(dir, "pin.json"),
      JSON.stringify({ files: { "list.md": { path: "x", sha256: "a".repeat(64) } } }),
    );
    expect(() => readPinnedUpstream("list.md", { dir, source: "pin.json" })).toThrow();
  });

  it.each([
    ["eraser-brokers.yaml", "eraser.source.json", /Eraser/i],
    ["ERASER-LICENSE", "eraser.source.json", /MIT License/],
    ["ca-registry-2026.csv", "ca-registry.source.json", /Data broker name/],
    ["optery-data-brokers.json", "optery.source.json", /"title"/],
    ["OPTERY-LICENSE.md", "optery.source.json", /NonCommercial-ShareAlike 4.0/],
  ])("verifies the committed %s", (name, source, pattern) => {
    expect(readPinnedUpstream(name, { source })).toMatch(pattern);
  });

  it("verifies the committed BADBOOL README and license", () => {
    expect(readPinnedUpstream("BADBOOL-README.md")).toMatch(/Big Ass Data Broker Opt-Out List/);
    expect(readPinnedUpstream("BADBOOL-LICENSE.md")).toMatch(
      /Attribution-NonCommercial-ShareAlike 4.0/,
    );
  });
});
