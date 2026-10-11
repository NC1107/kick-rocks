import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { modelThreshold } from "../thresholds.js";
import { MODEL_FILES, type ReplyModelManifest, sha256Of, verifyFiles } from "./manifest.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kickrocks-manifest-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function manifestFor(contents: Record<string, string>): ReplyModelManifest {
  return {
    files: Object.fromEntries(
      Object.entries(contents).map(([file, text]) => [
        file,
        { sha256: createHash("sha256").update(text).digest("hex"), bytes: text.length },
      ]),
    ),
  } as ReplyModelManifest;
}

const CONTENTS = Object.fromEntries(MODEL_FILES.map((file) => [file, `contents of ${file}`]));

describe("checking the files against the manifest", () => {
  it("accepts files that are what the manifest says", async () => {
    for (const [file, text] of Object.entries(CONTENTS)) writeFileSync(join(dir, file), text);
    expect(await verifyFiles(dir, manifestFor(CONTENTS))).toBeNull();
  });

  it("names the file whose bytes changed, even when its size did not", async () => {
    for (const [file, text] of Object.entries(CONTENTS)) writeFileSync(join(dir, file), text);
    writeFileSync(join(dir, "model.onnx"), "contents of model.onnY");
    expect(await verifyFiles(dir, manifestFor(CONTENTS))).toBe(
      "model.onnx does not match its digest in the manifest",
    );
  });

  it("hashes a file the way sha256sum does", async () => {
    writeFileSync(join(dir, "a"), "abc");
    expect(await sha256Of(join(dir, "a"))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});

describe("the threshold a model answer is applied at", () => {
  it("is the manifest's", () => {
    expect(modelThreshold(0.961, null)).toBe(0.961);
  });

  it("is raised by the setting and never lowered by it", () => {
    expect(modelThreshold(0.961, 0.98)).toBe(0.98);
    expect(modelThreshold(0.961, 0.9)).toBe(0.961);
  });

  it("never goes below 0.90, whatever the manifest says", () => {
    expect(modelThreshold(0.5, null)).toBe(0.9);
    expect(modelThreshold(0, 0)).toBe(0.9);
  });
});
