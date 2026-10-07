import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../src/index.css", import.meta.url), "utf8");

type Scheme = "light" | "dark";

/** Reads `--kr-name: light-dark(#a, #b)` or a single hex from a block of index.css. */
function readTokens(block: string): Record<string, { light: string; dark: string }> {
  const tokens: Record<string, { light: string; dark: string }> = {};
  for (const match of block.matchAll(
    /--kr-([a-z0-9-]+):\s*(?:light-dark\(\s*(#[0-9a-f]{6}),\s*(#[0-9a-f]{6})\s*\)|(#[0-9a-f]{6}));/g,
  )) {
    const [, name, light, dark, single] = match;
    if (!name) continue;
    tokens[name] = { light: light ?? single ?? "", dark: dark ?? single ?? "" };
  }
  return tokens;
}

const root = css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme: light)"));
const cyanStart = css.indexOf(':root[data-accent="cyan"]');
const cyan = css.slice(cyanStart, css.indexOf("}", cyanStart));
const base = readTokens(root);
const cyanTokens = readTokens(cyan);

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((at) => {
    const value = Number.parseInt(hex.slice(at, at + 2), 16) / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (channels[0] ?? 0) + 0.7152 * (channels[1] ?? 0) + 0.0722 * (channels[2] ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

function ratio(tokens: typeof base, scheme: Scheme, foreground: string, background: string) {
  const fg = tokens[foreground]?.[scheme];
  const bg = tokens[background]?.[scheme];
  if (!(fg && bg)) throw new Error(`Missing token ${foreground} or ${background}`);
  return contrast(fg, bg);
}

const SCHEMES: Scheme[] = ["dark", "light"];

describe("color tokens", () => {
  it("parses the full set for both schemes", () => {
    for (const name of [
      "frame",
      "canvas",
      "surface",
      "ink",
      "ink-3",
      "accent-fill",
      "danger-text",
    ]) {
      expect(base[name], name).toBeDefined();
    }
  });

  it.each(SCHEMES)("keeps text readable on the layers it sits on (%s)", (scheme) => {
    for (const text of ["ink", "ink-2", "ink-3"]) {
      for (const layer of ["canvas", "surface", "field", "hover"]) {
        expect(ratio(base, scheme, text, layer), `${text} on ${layer}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const text of ["ink", "ink-2", "ink-3"]) {
      for (const layer of ["rail", "frame"]) {
        expect(ratio(base, scheme, text, layer), `${text} on ${layer}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    for (const text of ["ink", "ink-2"]) {
      for (const layer of ["popover"]) {
        expect(ratio(base, scheme, text, layer), `${text} on ${layer}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it.each(SCHEMES)("keeps state text and links readable (%s)", (scheme) => {
    for (const text of ["accent-text", "positive-text", "attention-text", "danger-text"]) {
      for (const layer of ["canvas", "surface"]) {
        expect(ratio(base, scheme, text, layer), `${text} on ${layer}`).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(ratio(base, scheme, "accent-text", "accent-soft")).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SCHEMES)("keeps text on the accent fill readable (%s)", (scheme) => {
    expect(ratio(base, scheme, "accent-on", "accent-fill")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(base, scheme, "accent-on", "accent-fill-hover")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(base, scheme, "accent-on", "danger-solid")).toBeGreaterThanOrEqual(4.5);
  });

  it.each(SCHEMES)("gives controls and the focus ring a 3:1 edge (%s)", (scheme) => {
    expect(ratio(base, scheme, "line-strong", "surface")).toBeGreaterThanOrEqual(3);
    expect(ratio(base, scheme, "focus", "surface")).toBeGreaterThanOrEqual(3);
    expect(ratio(base, scheme, "focus", "canvas")).toBeGreaterThanOrEqual(3);
  });

  it.each(SCHEMES)("keeps the cyan fallback as readable as indigo (%s)", (scheme) => {
    const merged = { ...base, ...cyanTokens };
    expect(ratio(merged, scheme, "accent-text", "surface")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(merged, scheme, "accent-text", "accent-soft")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(merged, scheme, "accent-on", "accent-fill")).toBeGreaterThanOrEqual(4.5);
    expect(ratio(merged, scheme, "focus", "surface")).toBeGreaterThanOrEqual(3);
  });

  it("changes only the accent roles in the cyan fallback", () => {
    expect(Object.keys(cyanTokens).sort()).toEqual([
      "accent-fill",
      "accent-fill-hover",
      "accent-on",
      "accent-soft",
      "accent-text",
      "focus",
    ]);
  });
});
