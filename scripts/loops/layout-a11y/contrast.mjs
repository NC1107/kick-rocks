import { readFileSync } from "node:fs";

const TEXT_TOKENS = [
  "ink",
  "ink-2",
  "ink-3",
  "accent-text",
  "positive-text",
  "attention-text",
  "danger-text",
];
const SURFACE_TOKENS = [
  "frame",
  "rail",
  "canvas",
  "surface",
  "hover",
  "active",
  "field",
  "popover",
  "popover-hover",
  "accent-soft",
];
const TONES = [
  { name: "neutral", rgb: "neutral-rgb", ink: "ink-2" },
  { name: "positive", rgb: "positive-rgb", ink: "positive-text" },
  { name: "attention", rgb: "attention-rgb", ink: "attention-text" },
  { name: "danger", rgb: "danger-rgb", ink: "danger-text" },
];
const TONE_WASH_ALPHA = 0.12;
const TONE_LAYERS = ["surface", "canvas", "rail", "hover", "accent-soft"];
const MIN_HOVER_STEP = 1.05;
const HOVER_STEPS = [
  { layer: "hover", base: "surface" },
  { layer: "popover-hover", base: "popover" },
];
const LINE_LAYERS = ["surface", "canvas", "frame", "field"];

const channels = (hex) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));

function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a, b) {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const wash = (fg, bg, alpha) => fg.map((v, i) => Math.round(v * alpha + bg[i] * (1 - alpha)));

function readRgbChannels(block) {
  const found = {};
  for (const [, name, r, g, b] of block.matchAll(/--kr-([\w-]+-rgb):\s*(\d+)\s+(\d+)\s+(\d+)/g)) {
    found[name] = [Number(r), Number(g), Number(b)];
  }
  return found;
}

/** Reads the --kr-* color tokens of both themes from index.css so the matrix cannot drift from it. */
export function readThemeTokens(css) {
  const light = {};
  const dark = {};
  const pair = /--kr-([\w-]+):\s*light-dark\(\s*(#[0-9a-fA-F]{6})\s*,\s*(#[0-9a-fA-F]{6})\s*\)/g;
  for (const [, name, a, b] of css.matchAll(pair)) {
    light[name] = channels(a);
    dark[name] = channels(b);
  }
  const lightBlock = css.match(/:root\[data-theme="light"\]\s*\{[^}]*\}/)?.[0] ?? "";
  const darkBlock = css.match(/:root\s*\{[^}]*\}/)?.[0] ?? "";
  Object.assign(dark, readRgbChannels(darkBlock));
  Object.assign(light, readRgbChannels(lightBlock));
  return { light, dark };
}

export function failingContrastPairs(css) {
  const themes = readThemeTokens(css);
  const failing = [];
  for (const theme of ["light", "dark"]) {
    const t = themes[theme];
    for (const fg of TEXT_TOKENS) {
      for (const bg of SURFACE_TOKENS) {
        const ratio = contrastRatio(t[fg], t[bg]);
        if (ratio < 4.5) failing.push(`${theme} ${fg} on ${bg} ${ratio.toFixed(2)}`);
      }
    }
    for (const tone of TONES) {
      for (const layer of TONE_LAYERS) {
        const ratio = contrastRatio(t[tone.ink], wash(t[tone.rgb], t[layer], TONE_WASH_ALPHA));
        if (ratio < 4.5) {
          failing.push(`${theme} tone-${tone.name} ${tone.ink} on ${layer} ${ratio.toFixed(2)}`);
        }
      }
    }
    for (const { layer, base } of HOVER_STEPS) {
      const ratio = contrastRatio(t[layer], t[base]);
      if (ratio < MIN_HOVER_STEP)
        failing.push(`${theme} ${layer} against ${base} ${ratio.toFixed(2)}`);
    }
    for (const layer of LINE_LAYERS) {
      const ratio = contrastRatio(t["line-strong"], t[layer]);
      if (ratio < 3) failing.push(`${theme} line-strong on ${layer} ${ratio.toFixed(2)}`);
    }
  }
  return failing;
}

export function failingContrastPairsOf(cssPath) {
  return failingContrastPairs(readFileSync(cssPath, "utf8"));
}
