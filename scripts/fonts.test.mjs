import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const css = readFileSync(
  fileURLToPath(new URL("../apps/web/src/index.css", import.meta.url)),
  "utf8",
);

test("web fonts never swap in late, because a swap re-wraps text and shifts the page", () => {
  assert.doesNotMatch(css, /font-display:\s*swap/);
  assert.match(css, /font-display:\s*optional/);
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
