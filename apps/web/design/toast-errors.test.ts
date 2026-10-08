import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Errors never toast: they belong on the thing that failed. The deprecated toast.error helper
 * still exists for screens that have not moved, and this ceiling is lowered by hand each time a
 * screen drops its calls. It must never be raised.
 */
const REMAINING_TOAST_ERROR_CALLS = 11;

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "dev" ? [] : sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name) ? [path] : [];
  });
}

describe("toast.error call sites", () => {
  it("only ever go down", () => {
    const calls = sourceFiles(SRC)
      .filter((file) => !file.endsWith(join("components", "ui", "Toast.tsx")))
      .reduce(
        (total, file) =>
          total + (readFileSync(file, "utf8").match(/\btoast\.error\(/g)?.length ?? 0),
        0,
      );
    expect(calls).toBeLessThanOrEqual(REMAINING_TOAST_ERROR_CALLS);
  });
});
