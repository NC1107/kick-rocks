import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { simpleParser } from "mailparser";
import { afterAll, describe, expect, it } from "vitest";
import type { ClassificationResult, ReplyClassifier } from "../../mail/types.js";
import { type CorpusSet, FIXTURES_DIR, loadCorpus, loadLabels } from "./corpus.js";
import { DEV_ONLY_CATEGORIES, generateCorpus } from "./generate.js";
import { type IntakeReport, runIntake } from "./harness.js";
import { REQUESTS } from "./world.js";

const SETS: CorpusSet[] = ["dev", "held-out"];

describe("the synthetic mixed inbox", () => {
  it("holds at least 300 messages, split 60 to 40 between dev and held-out outside the dev-only categories", () => {
    const sharedDev = loadLabels("dev").filter(
      (label) => !DEV_ONLY_CATEGORIES.includes(label.category),
    ).length;
    const dev = sharedDev;
    const heldOut = loadLabels("held-out").length;
    expect(loadLabels("dev").length + heldOut).toBeGreaterThanOrEqual(300);
    expect(dev / (dev + heldOut)).toBeGreaterThan(0.58);
    expect(dev / (dev + heldOut)).toBeLessThan(0.62);
  });

  it("puts every category in both sets and keeps ignore and request mail in both", () => {
    const [dev, heldOut] = SETS.map((set) => loadLabels(set));
    const categories = (labels: typeof dev) => new Set(labels?.map((label) => label.category));
    expect(categories(heldOut)).toEqual(
      new Set([...categories(dev)].filter((name) => !DEV_ONLY_CATEGORIES.includes(name))),
    );
    expect(DEV_ONLY_CATEGORIES.length).toBeGreaterThan(0);
    for (const labels of [dev, heldOut]) {
      expect(labels?.some((label) => label.outcome === "ignore")).toBe(true);
      expect(labels?.some((label) => label.outcome === "auto")).toBe(true);
      expect(labels?.some((label) => label.outcome === "review")).toBe(true);
    }
  });

  it("labels request mail with a request and a class, and ignore mail with neither", () => {
    const keys = new Set(REQUESTS.map((request) => request.key));
    for (const label of SETS.flatMap((set) => loadLabels(set))) {
      if (label.outcome === "ignore") {
        expect(label.request, label.file).toBeNull();
        expect(label.classification, label.file).toBeNull();
      } else {
        expect(keys.has(label.request as never), label.file).toBe(true);
        expect(label.classification, label.file).not.toBeNull();
      }
    }
  });

  it("has real-looking headers and a unique Message-ID in every message", async () => {
    const seen = new Set<string>();
    const headerNames = new Set<string>();
    for (const message of SETS.flatMap((set) => loadCorpus(set))) {
      const parsed = await simpleParser(message.raw);
      expect(parsed.messageId, message.file).toBeTruthy();
      expect(seen.has(parsed.messageId as string), message.file).toBe(false);
      seen.add(parsed.messageId as string);
      for (const { key } of parsed.headerLines) headerNames.add(key);
    }
    for (const name of [
      "dkim-signature",
      "list-unsubscribe",
      "list-id",
      "precedence",
      "auto-submitted",
      "return-path",
      "reply-to",
      "in-reply-to",
      "references",
    ]) {
      expect(headerNames.has(name), name).toBe(true);
    }
  });

  describe("regeneration", () => {
    const scratch = mkdtempSync(join(tmpdir(), "mail-intake-corpus-"));
    afterAll(() => rmSync(scratch, { recursive: true, force: true }));

    it("reproduces the committed files byte for byte", async () => {
      await generateCorpus(scratch);
      for (const set of SETS) {
        const committed = readdirSync(join(FIXTURES_DIR, set)).sort();
        expect(readdirSync(join(scratch, set)).sort()).toEqual(committed);
        for (const file of committed) {
          expect(
            readFileSync(join(scratch, set, file)).equals(
              readFileSync(join(FIXTURES_DIR, set, file)),
            ),
            `${set}/${file}`,
          ).toBe(true);
        }
      }
    }, 120_000);
  });
});

describe("the intake harness", () => {
  let dev: IntakeReport;

  const ranDev = async () => {
    dev ??= await runIntake("dev");
    return dev;
  };

  it("runs every dev message through the real poll and accounts for each one", async () => {
    const report = await ranDev();
    expect(report.total).toBe(loadLabels("dev").length);
    expect(report.ignoreMail + report.requestMail).toBe(report.total);
    for (const value of Object.values(report.metrics)) {
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    }
    expect(report.categories.reduce((sum, category) => sum + category.total, 0)).toBe(report.total);
  }, 120_000);

  it("counts a stored ignore message once as kept, and as a false positive only when it also acted", async () => {
    const report = await ranDev();
    expect(report.metrics.storedIgnored).toBeLessThanOrEqual(report.ignoreMail);
    expect(report.metrics.falsePositives).toBeLessThanOrEqual(report.ignoreMail);
  }, 120_000);

  it("applies mail that is signed by the broker and quotes the request, with no misses", async () => {
    const report = await ranDev();
    for (const name of ["reply_quoted_signed", "reply_reference_signed", "autoresponder"]) {
      const category = report.categories.find((entry) => entry.category === name);
      expect(category, name).toBeDefined();
      expect(category?.falseNegatives, name).toBe(0);
      expect(category?.misrouted, name).toBe(0);
    }
  }, 120_000);

  it("reports a classifier that ignores everything as hiding review mail and misrouting applied mail, with no false positives", async () => {
    const nothing: ClassificationResult = {
      requestId: null,
      correlation: null,
      classification: "unrelated",
      confidence: 0.9,
      rationale: "ignores everything",
      links: [],
      requestedFields: [],
      source: "rules",
      apply: true,
      suggestion: null,
      prediction: {
        rules: { label: "unrelated", confidence: 0.9 },
        model: null,
        inputSha256: null,
      },
    };
    const blind: ReplyClassifier = { classify: async () => nothing };
    const report = await runIntake("dev", { classifier: () => blind });
    expect(report.metrics.falsePositives).toBe(0);
    const labels = loadLabels("dev");
    const verdictOf = (file: string) => report.extra.verdicts[file] ?? "ignored";
    const lost = (label: (typeof labels)[number]) =>
      verdictOf(label.file) === "ignored" ||
      (label.outcome === "review" && verdictOf(label.file).endsWith("handled"));
    const wanted = labels.filter((label) => label.outcome !== "ignore");
    // Nothing is attached or applied, so applied mail that was kept is misrouted, and review mail is
    // missed only when it was dropped or filed as handled instead of waiting unattached in Review.
    expect(report.metrics.falseNegatives).toBe(wanted.filter(lost).length);
    expect(report.metrics.misrouted).toBe(
      wanted.filter((label) => label.outcome === "auto" && !lost(label)).length,
    );
  }, 120_000);

  it("keeps nothing of the mail it ignores, and misses and misroutes nothing", async () => {
    const report = await ranDev();
    expect(report.metrics).toEqual({
      falsePositives: 0,
      falseNegatives: 0,
      storedIgnored: 0,
      misrouted: 0,
    });
  }, 120_000);

  it("files a correct reply to a request that is already over as handled", async () => {
    const report = await ranDev();
    expect(report.extra.needlessReview).toBe(0);
  }, 120_000);

  it("downloads almost none of the mail it ends up ignoring when the server can search", async () => {
    const report = await ranDev();
    expect(report.extra.downloadedIgnored).toBeLessThanOrEqual(10);
  }, 120_000);

  it("reaches the same verdict for every message when the server refuses SEARCH", async () => {
    const report = await ranDev();
    const without = await runIntake("dev", { searchSupported: false });
    expect(without.metrics).toEqual(report.metrics);
    expect(without.extra.verdicts).toEqual(report.extra.verdicts);
  }, 240_000);
});
