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

  it("verifies the committed BADBOOL README and license", () => {
    expect(readPinnedUpstream("BADBOOL-README.md")).toMatch(/Big Ass Data Broker Opt-Out List/);
    expect(readPinnedUpstream("BADBOOL-LICENSE.md")).toMatch(
      /Attribution-NonCommercial-ShareAlike 4.0/,
    );
  });
});
