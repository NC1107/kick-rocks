import { mkdirSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ReplyClassification } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReplyModelHost } from "./host.js";
import { INPUT_FORMAT_VERSION } from "./input.js";
import { MODEL_FILES, type ReplyModelManifest } from "./manifest.js";

const WORKER = fileURLToPath(
  new URL("../../test-utils/fake-reply-model-worker.mjs", import.meta.url),
);
const ZERO = "0".repeat(64);

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kickrocks-reply-model-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function install(
  overrides: Partial<ReplyModelManifest> = {},
  files: readonly string[] = MODEL_FILES,
) {
  for (const file of files) writeFileSync(join(dir, file), "x");
  const manifest: ReplyModelManifest = {
    schemaVersion: 1,
    version: "v7",
    baseModel: {
      id: "answerdotai/ModernBERT-base",
      revision: "8949b909ec900327062f0ebf497f51aef5e6f0c8",
    },
    labels: [...ReplyClassification.options],
    temperature: 1.2,
    maxLen: 384,
    inputFormat: INPUT_FORMAT_VERSION,
    threshold: 0.961,
    training: {
      dataSha256: ZERO,
      scriptSha256: ZERO,
      lockfileSha256: ZERO,
      seed: 13,
      epochs: 6,
      folds: 5,
      batchSize: 8,
      learningRate: 3e-5,
      device: "cpu",
      libraries: {},
    },
    metrics: {
      outOfFold: {
        replies: 1,
        accuracy: 1,
        atThreshold: { answers: 1, correct: 1, precision: 1, low: 0.2, high: 1 },
      },
      heldout: {
        replies: 1,
        accuracy: 1,
        atThreshold: { answers: 1, correct: 1, precision: 1, low: 0.2, high: 1 },
      },
    },
    files: Object.fromEntries(MODEL_FILES.map((file) => [file, { sha256: ZERO, bytes: 1 }])),
    ...overrides,
  };
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  return manifest;
}

function host(options: Partial<Parameters<typeof createReplyModelHost>[0]> = {}) {
  return createReplyModelHost({
    dir,
    workerPath: WORKER,
    availableMemory: () => 8 * 1024 ** 3,
    requestTimeoutMs: 3000,
    loadTimeoutMs: 5000,
    ...options,
  });
}

/** Same size as the manifest lists, with a newer modification time, as a fresh copy of the file would have. */
function replaceFile(name: string) {
  writeFileSync(join(dir, name), "y");
  const later = new Date(Date.now() + 60_000);
  utimesSync(join(dir, name), later, later);
}

const input = (body: string) => ({ subject: "Re: request", body });
const starts = () =>
  readFileSync(join(dir, "starts.log"), "utf8").trim().split("\n").filter(Boolean).map(Number);

describe("the reply model's state", () => {
  it("is not installed without a folder or a manifest", async () => {
    expect(createReplyModelHost({ dir: null }).status()).toMatchObject({ state: "not_installed" });
    expect(host().status()).toMatchObject({ state: "not_installed", reason: null });
    expect(await host().predict(input("hello"))).toMatchObject({ ok: false });
  });

  it("is loaded once the manifest and files agree", () => {
    install();
    expect(host().status()).toEqual({
      state: "loaded",
      reason: null,
      version: "v7",
      threshold: 0.961,
    });
  });

  it.each([
    [
      "a manifest that is not JSON",
      () => writeFileSync(join(dir, "manifest.json"), "{"),
      /cannot be read/,
    ],
    ["a missing model file", () => rmSync(join(dir, "model.onnx")), /model.onnx is missing/],
    ["a model of another size", () => writeFileSync(join(dir, "model.onnx"), "xx"), /not the size/],
  ])("fails for %s", (_name, damage, reason) => {
    install();
    damage();
    const status = host().status();
    expect(status.state).toBe("failed");
    expect(status.reason).toMatch(reason);
  });

  it("fails for an input format it does not write", () => {
    install({ inputFormat: INPUT_FORMAT_VERSION + 1 });
    expect(host().status().reason).toMatch(/input format/);
  });

  it("fails when the labels are not the classifications this server knows", () => {
    install({ labels: ReplyClassification.options.slice(1) });
    expect(host().status().reason).toMatch(/labels/);
  });

  it("fails when a file is not listed", () => {
    install({ files: {} });
    expect(host().status().reason).toMatch(/does not list/);
  });
});

describe("answering", () => {
  it("maps the scores to labels by name, whatever order the model was trained in", async () => {
    const reversed = [...ReplyClassification.options].reverse();
    install({ labels: reversed });
    const subject = host();
    const first = await subject.predict(input("hello"));
    const second = await subject.predict(input("SECOND"));
    expect(first).toMatchObject({
      ok: true,
      answer: { label: reversed[0], version: "v7", manifestThreshold: 0.961 },
    });
    expect(second).toMatchObject({ ok: true, answer: { label: reversed[1] } });
    if (first.ok)
      expect(first.answer.probabilities[reversed[0] as ReplyClassification]).toBeGreaterThan(0.9);
    await subject.close();
  });

  it("answers requests that arrive together, one at a time", async () => {
    install();
    const subject = host();
    const results = await Promise.all(
      ["a", "SECOND", "b"].map((text) => subject.predict(input(text))),
    );
    expect(results.map((result) => result.ok)).toEqual([true, true, true]);
    expect(starts()).toHaveLength(1);
    await subject.close();
  });

  it("starts again after the child crashed, and costs only that reply its answer", async () => {
    install();
    const subject = host();
    expect((await subject.predict(input("ok"))).ok).toBe(true);
    const crashed = await subject.predict(input("CRASH"));
    expect(crashed).toMatchObject({ ok: false });
    expect((await subject.predict(input("ok"))).ok).toBe(true);
    expect(starts()).toHaveLength(2);
    await subject.close();
  });

  it("gives up on a child that does not answer in time and replaces it", async () => {
    install();
    const subject = host({ requestTimeoutMs: 300 });
    const slow = await subject.predict(input("HANG"));
    expect(slow).toMatchObject({ ok: false, reason: expect.stringMatching(/took longer/) });
    expect((await subject.predict(input("ok"))).ok).toBe(true);
    const [first] = starts();
    expect(() => process.kill(first as number, 0)).toThrow();
    await subject.close();
  });

  it("starts the child with the runtime's usage telemetry switched off", async () => {
    install();
    const subject = host();
    await subject.predict(input("ok"));
    expect(readFileSync(join(dir, "env.log"), "utf8").trim()).toBe("1");
    await subject.close();
  });

  it("does not start with too little free memory", async () => {
    install();
    const subject = host({ availableMemory: () => 512 * 1024 ** 2 });
    const result = await subject.predict(input("ok"));
    expect(result).toMatchObject({
      ok: false,
      reason: "Not enough free memory for the reply model",
    });
    expect(() => readFileSync(join(dir, "starts.log"))).toThrow();
    expect(subject.status()).toMatchObject({
      state: "loaded",
      reason: "Not enough free memory for the reply model",
    });
  });

  it("stops naming the skip once a reply gets its answer", async () => {
    install();
    let free = 512 * 1024 ** 2;
    const subject = host({ availableMemory: () => free });
    await subject.predict(input("a"));
    expect(subject.status().reason).not.toBeNull();
    free = 8 * 1024 ** 3;
    await subject.predict(input("b"));
    expect(subject.status().reason).toBeNull();
    await subject.close();
  });

  it("exits after it has been idle, and starts again on the next reply", async () => {
    install();
    const subject = host({ idleMs: 150 });
    await subject.predict(input("ok"));
    await new Promise((resolve) => setTimeout(resolve, 500));
    const [first] = starts();
    expect(() => process.kill(first as number, 0)).toThrow();
    await subject.predict(input("ok"));
    expect(starts()).toHaveLength(2);
    await subject.close();
  });

  it("reports a model whose files fail their check, and says so in its state", async () => {
    install();
    writeFileSync(join(dir, "FAIL_LOAD"), "");
    const subject = host();
    const result = await subject.predict(input("ok"));
    expect(result).toMatchObject({
      ok: false,
      reason: expect.stringMatching(/does not match its digest/),
    });
    expect(subject.status()).toMatchObject({ state: "failed", version: "v7" });
    await subject.close();
  });

  it("reports each reason once, even when the figures in it change", async () => {
    install();
    const reasons: Array<[string, Record<string, number> | undefined]> = [];
    let free = 100 * 1024 ** 2;
    const subject = host({
      availableMemory: () => (free += 1024 ** 2),
      log: (reason, fields) => reasons.push([reason, fields]),
    });
    await subject.predict(input("a"));
    await subject.predict(input("b"));
    expect(reasons).toHaveLength(1);
    expect(reasons[0]?.[1]).toMatchObject({ freeMiB: 101 });
  });

  it("does not start a child again for files that already failed to load", async () => {
    install();
    writeFileSync(join(dir, "FAIL_LOAD"), "");
    const subject = host();
    await subject.predict(input("a"));
    const again = await subject.predict(input("b"));
    expect(again).toMatchObject({ ok: false, reason: expect.stringMatching(/digest/) });
    expect(starts()).toHaveLength(1);
    await subject.close();
  });

  it("tries again once the model files are replaced", async () => {
    install();
    writeFileSync(join(dir, "FAIL_LOAD"), "");
    const subject = host();
    await subject.predict(input("a"));
    rmSync(join(dir, "FAIL_LOAD"));
    replaceFile("model.onnx");
    const result = await subject.predict(input("b"));
    expect(result).toMatchObject({ ok: true });
    expect(subject.status().state).toBe("loaded");
    expect(starts()).toHaveLength(2);
    await subject.close();
  });

  it("checks the files' digests in the first child only", async () => {
    install();
    const subject = host({ idleMs: 100 });
    await subject.predict(input("a"));
    await new Promise((resolve) => setTimeout(resolve, 400));
    await subject.predict(input("b"));
    expect(readFileSync(join(dir, "verified.log"), "utf8").trim().split("\n")).toEqual([
      "false",
      "true",
    ]);
    replaceFile("tokenizer.json");
    await new Promise((resolve) => setTimeout(resolve, 400));
    await subject.predict(input("c"));
    expect(readFileSync(join(dir, "verified.log"), "utf8").trim().split("\n")).toEqual([
      "false",
      "true",
      "false",
    ]);
    await subject.close();
  });
});

describe("a folder made by hand", () => {
  it("is read the same way", () => {
    mkdirSync(join(dir, "nested"));
    expect(createReplyModelHost({ dir: join(dir, "nested") }).status().state).toBe("not_installed");
  });
});
