import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  fileURLToPath(new URL("../apps/web/src/index.css", import.meta.url)),
  "utf8",
);

test("every web font face swaps in, so a slow link still ends up in the brand font", () => {
  const faces = css.match(/@font-face\s*{[^}]*url\([^}]*}/g) ?? [];
  assert.ok(faces.length > 0);
  for (const face of faces) assert.match(face, /font-display:\s*swap/);
  assert.doesNotMatch(css, /font-display:\s*(optional|block)/);
});

for (const kind of ["Sans", "Mono"]) {
  test(`IBM Plex ${kind} has a metric-matched local fallback ahead of the system fonts`, () => {
    const face = css.match(
      new RegExp(`@font-face\\s*{[^}]*font-family: "IBM Plex ${kind} Fallback"[^}]*}`),
    );
    assert.ok(face, "fallback face is declared");
    assert.match(face[0], /size-adjust:/);
    assert.match(face[0], /ascent-override:/);
    assert.ok(css.includes(`"IBM Plex ${kind}", "IBM Plex ${kind} Fallback"`));
  });
}

test("the Sans fallback has a face per weight, so a medium or semibold label keeps its width", () => {
  const weights = [...css.matchAll(/font-family: "IBM Plex Sans Fallback";\s*font-weight: (\d+)/g)];
  assert.deepEqual(
    weights.map((m) => m[1]),
    ["400", "500", "600"],
  );
});
