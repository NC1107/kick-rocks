import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { withProvenRules } from "../../src/test-utils/proven-rules.js";
import { addressOf, loadRealReplies, sourceUrls } from "./real-corpus.js";
import { summarize } from "./real-report.js";
import { classifyReplies } from "./real-run.js";

function corpus(): string {
  const dir = mkdtempSync(join(tmpdir(), "real-replies-"));
  mkdirSync(join(dir, "public"));
  const reply = (name: string, text: string, from: string | null) =>
    writeFileSync(
      join(dir, "public", name),
      JSON.stringify({ company: "Acme Data", subject: "Re: your request", text, from }),
    );
  reply(
    "a.json",
    "Acme Data has processed your request and your information has been removed from our database. You have been opted out.",
    null,
  );
  reply("b.json", "Something unclear", "Privacy <privacy@acme.example>");
  reply("c.json", "Skipped as ambiguous", null);
  const entry = (file: string, classification: string | null, ambiguous: boolean) => ({
    file: `public/${file}`,
    company: "Acme Data",
    source: `https://example.test/${file}`,
    classification,
    ambiguous,
  });
  writeFileSync(
    join(dir, "labels.json"),
    JSON.stringify({
      replies: [
        entry("a.json", "completed", false),
        entry("b.json", "unknown", false),
        entry("c.json", null, true),
      ],
    }),
  );
  return dir;
}

describe("the real reply corpus", () => {
  it("loads labeled replies and leaves ambiguous ones out", () => {
    const replies = loadRealReplies(corpus());
    expect(replies.map((reply) => reply.id)).toEqual(["public/a.json", "public/b.json"]);
    expect(replies[1]?.fromAddress).toBe("privacy@acme.example");
    expect(sourceUrls(replies)).toEqual([
      "https://example.test/a.json",
      "https://example.test/b.json",
    ]);
  });

  it("reads an address out of a display name", () => {
    expect(addressOf("Jane <Jane@Example.com>")).toBe("jane@example.com");
    expect(addressOf("Support team")).toBeNull();
    expect(addressOf(null)).toBeNull();
  });

  it("applies nothing while no rule is proven", async () => {
    const replies = loadRealReplies(corpus()).slice(0, 1);
    const named = await classifyReplies(replies, "named", {});
    expect(named[0]?.apply).toBe(false);
    expect(named[0]?.label).toBe("completed");
  });

  describe("with a proven rule", () => {
    withProvenRules("has-been-done");

    it("applies a reply that names the company and holds it when the request is for another", async () => {
      const replies = loadRealReplies(corpus()).slice(0, 1);
      const named = await classifyReplies(replies, "named", {});
      const unnamed = await classifyReplies(replies, "unnamed", {});
      expect(named[0]?.apply).toBe(true);
      expect(unnamed[0]?.apply).toBe(false);
      expect(unnamed[0]?.label).toBe(named[0]?.label);
    });
  });

  it("counts what is applied and how much of it is wrong", () => {
    const summary = summarize([
      { truth: "completed", label: "completed", confidence: 0.9, apply: true, source: "rules" },
      { truth: "needs_form", label: "completed", confidence: 0.9, apply: true, source: "rules" },
      { truth: "auto_ack", label: "auto_ack", confidence: 0.4, apply: false, source: "rules" },
    ]);
    expect(summary).toMatchObject({ applied: 2, appliedWrong: 1, review: 1 });
    expect(summary.recall.completed).toEqual({ hits: 1, support: 1 });
    expect(summary.recall.needs_form).toEqual({ hits: 0, support: 1 });
  });
});
