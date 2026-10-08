import assert from "node:assert/strict";
import { test } from "node:test";
import { contrastRatio, failingContrastPairs } from "./contrast.mjs";

const css = (inkLight) => `
:root {
  --kr-frame: light-dark(#ffffff, #000000);
  --kr-rail: light-dark(#ffffff, #000000);
  --kr-canvas: light-dark(#ffffff, #000000);
  --kr-surface: light-dark(#ffffff, #000000);
  --kr-hover: light-dark(#ffffff, #000000);
  --kr-active: light-dark(#ffffff, #000000);
  --kr-field: light-dark(#ffffff, #000000);
  --kr-popover: light-dark(#ffffff, #000000);
  --kr-popover-hover: light-dark(#ffffff, #000000);
  --kr-accent-soft: light-dark(#ffffff, #000000);
  --kr-line-strong: light-dark(#000000, #ffffff);
  --kr-ink: light-dark(${inkLight}, #ffffff);
  --kr-ink-2: light-dark(#000000, #ffffff);
  --kr-ink-3: light-dark(#000000, #ffffff);
  --kr-accent-text: light-dark(#000000, #ffffff);
  --kr-positive-text: light-dark(#000000, #ffffff);
  --kr-attention-text: light-dark(#000000, #ffffff);
  --kr-danger-text: light-dark(#000000, #ffffff);
  --kr-neutral-rgb: 128 128 128;
  --kr-positive-rgb: 128 128 128;
  --kr-attention-rgb: 128 128 128;
  --kr-danger-rgb: 128 128 128;
}
:root[data-theme="light"] {
  --kr-neutral-rgb: 128 128 128;
  --kr-positive-rgb: 128 128 128;
  --kr-attention-rgb: 128 128 128;
  --kr-danger-rgb: 128 128 128;
}`;

test("black on white is 21:1", () => {
  assert.equal(contrastRatio([0, 0, 0], [255, 255, 255]).toFixed(1), "21.0");
});

test("a text token that is too faint on its surfaces is reported", () => {
  assert.deepEqual(failingContrastPairs(css("#000000")), []);
  assert.ok(failingContrastPairs(css("#bbbbbb")).some((line) => line.startsWith("light ink on")));
});
