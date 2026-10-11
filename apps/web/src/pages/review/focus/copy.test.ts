import { NeedsYouKind } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { CHIP_LABELS, KIND_COPY, OTHER_OUTCOMES, sendDetails, WORDS } from "./copy.js";

const words = (text: string) => text.trim().split(/\s+/).length;
const sentences = (text: string) => text.split(/[.!?]+\s*/).filter(Boolean).length;

/** Everything the card says, so the rules below cannot miss a string. */
const everything = [
  ...Object.values(KIND_COPY).flatMap((copy) => [
    copy.tag,
    ...copy.steps,
    ...(copy.hint ? [copy.hint] : []),
    copy.primary,
    ...(copy.second ? [copy.second] : []),
    copy.question,
  ]),
  ...OTHER_OUTCOMES.map((entry) => entry.label),
  ...Object.values(CHIP_LABELS),
  ...Object.values(WORDS).flatMap((word) => (typeof word === "string" ? [word] : [])),
  sendDetails(1),
  sendDetails(3),
];

describe("the words on a Needs you card", () => {
  it("covers every kind", () => {
    expect(Object.keys(KIND_COPY).sort()).toEqual([...NeedsYouKind.options].sort());
  });

  it("keeps a tag to two words", () => {
    for (const [kind, copy] of Object.entries(KIND_COPY)) {
      expect(words(copy.tag), `${kind} tag`).toBeLessThanOrEqual(2);
    }
  });

  it("keeps to three steps of five words", () => {
    for (const [kind, copy] of Object.entries(KIND_COPY)) {
      expect(copy.steps.length, `${kind} steps`).toBeLessThanOrEqual(3);
      for (const step of copy.steps) {
        expect(words(step), `${kind}: ${step}`).toBeLessThanOrEqual(5);
      }
    }
  });

  it("keeps a hint to one sentence of eight words", () => {
    for (const [kind, copy] of Object.entries(KIND_COPY)) {
      if (!copy.hint) continue;
      expect(sentences(copy.hint), `${kind} hint`).toBe(1);
      expect(words(copy.hint), `${kind} hint`).toBeLessThanOrEqual(8);
    }
  });

  it("keeps a button label to four words", () => {
    for (const copy of Object.values(KIND_COPY)) {
      expect(words(copy.primary)).toBeLessThanOrEqual(4);
      if (copy.second) expect(words(copy.second)).toBeLessThanOrEqual(4);
    }
  });

  it("never uses an em dash", () => {
    for (const text of everything) expect(text).not.toContain("—");
  });
});
