import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fontPreloads, precompressDirectory } from "./web-delivery.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kickrocks-precompress-"));
  mkdirSync(join(dir, "assets"));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("precompressDirectory", () => {
  it("writes a brotli and a gzip file that decode to the original", () => {
    const script = "export const answer = 42;\n".repeat(200);
    writeFileSync(join(dir, "assets", "app-abc.js"), script);

    precompressDirectory(dir);

    const brotli = readFileSync(join(dir, "assets", "app-abc.js.br"));
    const gzip = readFileSync(join(dir, "assets", "app-abc.js.gz"));
    expect(brotliDecompressSync(brotli).toString()).toBe(script);
    expect(gunzipSync(gzip).toString()).toBe(script);
    expect(brotli.length).toBeLessThan(script.length);
  });

  it("leaves fonts, tiny files and files that do not shrink alone", () => {
    writeFileSync(join(dir, "assets", "face-abc.woff2"), "x".repeat(5000));
    writeFileSync(join(dir, "tiny.js"), "// tiny");
    writeFileSync(join(dir, "assets", "chunk.js"), randomBytes(4096));

    precompressDirectory(dir);

    expect(readdirSync(dir).sort()).toEqual(["assets", "tiny.js"]);
    expect(readdirSync(join(dir, "assets")).filter((name) => /\.(br|gz)$/.test(name))).toEqual([]);
  });
});

describe("fontPreloads", () => {
  it("preloads only the Latin Regular and SemiBold Plex Sans faces, as anonymous CORS", () => {
    const tags = fontPreloads(
      [
        "assets/IBMPlexSans-SemiBold-Latin1-CIhZjzyK.woff2",
        "assets/IBMPlexSans-Regular-Latin1-BUjEsRx4.woff2",
        "assets/IBMPlexSans-Regular-Latin2-DVrf9P05.woff2",
        "assets/IBMPlexSans-Italic-Latin1-D6ilVweT.woff2",
        "assets/IBMPlexMono-Regular-Latin1-DYPusg7z.woff2",
        "assets/index-DwL26EAw.js",
      ],
      "/",
    );
    expect(tags.map((tag) => (tag.attrs as Record<string, string>).href)).toEqual([
      "/assets/IBMPlexSans-Regular-Latin1-BUjEsRx4.woff2",
      "/assets/IBMPlexSans-SemiBold-Latin1-CIhZjzyK.woff2",
    ]);
    expect(tags[0]?.attrs).toMatchObject({ rel: "preload", as: "font", crossorigin: "" });
  });
});
