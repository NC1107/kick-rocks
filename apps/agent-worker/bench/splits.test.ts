import { ReplyClassification } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { HELDOUT_DIR, hashDirectory, recordedHeldoutHash } from "./heldout-hash.js";
import { REPLY_CASES } from "./reply-cases.js";
import { ORIGINAL_SCENARIOS } from "./scenarios.js";
import {
  ALL_REPLY_CASES,
  ALL_SCENARIOS,
  DEV_REPLY_CASES,
  DEV_SCENARIOS,
  HELDOUT_REPLY_CASES,
  HELDOUT_SCENARIOS,
} from "./splits.js";

const share = (part: number, whole: number) => part / whole;

describe("the dev and held-out sets", () => {
  it("keep the original twelve scenarios and forty replies in dev", () => {
    expect(DEV_SCENARIOS.slice(0, 12)).toEqual(ORIGINAL_SCENARIOS);
    expect(ORIGINAL_SCENARIOS.map((s) => s.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(DEV_REPLY_CASES.slice(0, 40)).toEqual(REPLY_CASES);
    expect(REPLY_CASES).toHaveLength(40);
  });

  it("give every scenario and reply one id, in one set", () => {
    const scenarioIds = ALL_SCENARIOS.map((s) => s.id);
    expect(new Set(scenarioIds).size).toBe(scenarioIds.length);
    const replyIds = ALL_REPLY_CASES.map((c) => c.id);
    expect(new Set(replyIds).size).toBe(replyIds.length);
    const slugs = ALL_SCENARIOS.map((s) => s.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("hold at least twelve new scan scenarios and 150 replies in all", () => {
    const newScans = ALL_SCENARIOS.filter((s) => s.id > 12 && s.purpose === "scan");
    expect(newScans.length).toBeGreaterThanOrEqual(12);
    expect(ALL_REPLY_CASES.length).toBeGreaterThanOrEqual(150);
  });

  it("put about 40 percent of each in the held-out set", () => {
    expect(share(HELDOUT_SCENARIOS.length, ALL_SCENARIOS.length)).toBeGreaterThan(0.35);
    expect(share(HELDOUT_SCENARIOS.length, ALL_SCENARIOS.length)).toBeLessThan(0.45);
    expect(share(HELDOUT_REPLY_CASES.length, ALL_REPLY_CASES.length)).toBeGreaterThan(0.35);
    expect(share(HELDOUT_REPLY_CASES.length, ALL_REPLY_CASES.length)).toBeLessThan(0.45);
  });

  it("cover every reply class in both sets, and in about the same proportion", () => {
    for (const name of ReplyClassification.options) {
      const dev = DEV_REPLY_CASES.filter((c) => c.truth === name).length;
      const heldout = HELDOUT_REPLY_CASES.filter((c) => c.truth === name).length;
      expect(dev, `${name} in dev`).toBeGreaterThanOrEqual(8);
      expect(heldout, `${name} in held-out`).toBeGreaterThanOrEqual(6);
      const heldoutShare = share(heldout, dev + heldout);
      expect(heldoutShare, name).toBeGreaterThan(0.3);
      expect(heldoutShare, name).toBeLessThan(0.5);
    }
  });

  it("cover every reply style in both sets", () => {
    for (const style of [
      "autoresponder",
      "ticket",
      "legal",
      "id-request",
      "partial",
      "no-sale-denial",
      "odd-link",
      "quoted-thread",
      "html-text",
      "other-people",
    ]) {
      expect(
        DEV_REPLY_CASES.some((c) => c.style === style),
        `${style} in dev`,
      ).toBe(true);
      expect(
        HELDOUT_REPLY_CASES.some((c) => c.style === style),
        `${style} in held-out`,
      ).toBe(true);
    }
  });

  it("cover every new scan situation in both sets", () => {
    const typesOf = (scenarios: typeof DEV_SCENARIOS) =>
      new Set(scenarios.filter((s) => s.id > 12).map((s) => s.type));
    const dev = typesOf(DEV_SCENARIOS);
    const heldout = typesOf(HELDOUT_SCENARIOS);
    expect([...heldout].sort()).toEqual([...dev].sort());
    expect([...dev].sort()).toEqual([
      "age-or-birth-year",
      "detail-page",
      "injection",
      "moved-past-city",
      "multi-page",
      "name-variant",
      "near-duplicates",
      "no-results",
      "relatives",
      "view-more",
    ]);
  });

  it("explain every new reply and give every verification reply its fields", () => {
    for (const reply of [...DEV_REPLY_CASES.slice(40), ...HELDOUT_REPLY_CASES]) {
      expect(reply.why, `${reply.id} has a reason`).toBeTruthy();
      expect(reply.style, `${reply.id} has a style`).toBeTruthy();
    }
    for (const reply of ALL_REPLY_CASES) {
      if (reply.truth === "verification_required") {
        expect(reply.requestedFields, `${reply.id} lists its fields`).toBeDefined();
      } else {
        expect(reply.requestedFields ?? [], `${reply.id} asks for none`).toEqual([]);
      }
    }
  });

  it("keep every reply under the length the server reads, and out of real domains", () => {
    for (const reply of ALL_REPLY_CASES) {
      expect(reply.body.length, reply.id).toBeLessThanOrEqual(4000);
      expect(reply.body, reply.id).not.toContain("\u2014");
      const hosts = [
        ...reply.body.matchAll(/https?:\/\/([a-z0-9.-]+)/gi),
        ...reply.body.matchAll(/@([a-z0-9.-]+\.[a-z]{2,})/gi),
      ].map((match) => match[1] ?? "");
      for (const host of hosts) {
        expect(host, `${reply.id} names ${host}`).toMatch(/example|\.test$/i);
      }
    }
  });
});

describe("the held-out directory", () => {
  it("matches the digest recorded in heldout.sha256", () => {
    expect(
      hashDirectory(HELDOUT_DIR),
      "The held-out files changed. If that was on purpose, run pnpm --filter @kickrocks/agent-worker exec tsx bench/heldout-hash.ts --write and say so in the commit.",
    ).toBe(recordedHeldoutHash());
  });

  it("changes its digest when a file changes", async () => {
    const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = mkdtempSync(join(tmpdir(), "heldout-hash-"));
    try {
      writeFileSync(join(dir, "a.ts"), "one");
      const before = hashDirectory(dir);
      writeFileSync(join(dir, "a.ts"), "two");
      expect(hashDirectory(dir)).not.toBe(before);
      writeFileSync(join(dir, "a.ts"), "one");
      expect(hashDirectory(dir)).toBe(before);
      writeFileSync(join(dir, "b.ts"), "");
      expect(hashDirectory(dir)).not.toBe(before);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
