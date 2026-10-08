import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  appLoaderSource,
  entryChunks,
  fontFiles,
  precompressDirectory,
  webDelivery,
  withoutStartupTags,
} from "./web-delivery.js";

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

describe("fontFiles", () => {
  it("lists the Latin Plex Sans Regular, Medium and SemiBold faces and the Mono SemiBold logo face", () => {
    const files = fontFiles(
      [
        "assets/IBMPlexSans-SemiBold-Latin1-CIhZjzyK.woff2",
        "assets/IBMPlexSans-Regular-Latin1-BUjEsRx4.woff2",
        "assets/IBMPlexSans-Medium-Latin1-B2CuUu4P.woff2",
        "assets/IBMPlexMono-SemiBold-Latin1-ChfWfxA6.woff2",
        "assets/IBMPlexSans-Regular-Latin2-DVrf9P05.woff2",
        "assets/IBMPlexSans-Italic-Latin1-D6ilVweT.woff2",
        "assets/IBMPlexMono-Regular-Latin1-DYPusg7z.woff2",
        "assets/index-DwL26EAw.js",
      ],
      "/",
    );
    expect(files).toEqual([
      "/assets/IBMPlexMono-SemiBold-Latin1-ChfWfxA6.woff2",
      "/assets/IBMPlexSans-Medium-Latin1-B2CuUu4P.woff2",
      "/assets/IBMPlexSans-Regular-Latin1-BUjEsRx4.woff2",
      "/assets/IBMPlexSans-SemiBold-Latin1-CIhZjzyK.woff2",
    ]);
  });
});

describe("entryChunks", () => {
  it("returns the entry and every chunk it imports statically, each once", () => {
    const bundle = {
      "assets/index-a.js": {
        type: "chunk",
        fileName: "assets/index-a.js",
        isEntry: true,
        imports: ["assets/ui-b.js", "assets/zod-c.js"],
      },
      "assets/ui-b.js": { type: "chunk", fileName: "assets/ui-b.js", imports: ["assets/zod-c.js"] },
      "assets/zod-c.js": { type: "chunk", fileName: "assets/zod-c.js", imports: [] },
      "assets/page-d.js": { type: "chunk", fileName: "assets/page-d.js", imports: [] },
      "assets/face.woff2": { type: "asset", fileName: "assets/face.woff2" },
    };
    expect(entryChunks(bundle)).toEqual({
      entry: "assets/index-a.js",
      preloads: ["assets/ui-b.js", "assets/zod-c.js"],
    });
  });
});

describe("the page startup", () => {
  const page = [
    "<head>",
    '<script src="/theme-init.js"></script>',
    '<script type="module" crossorigin src="/assets/index-a.js"></script>',
    '<link rel="modulepreload" crossorigin href="/assets/ui-b.js">',
    '<link rel="stylesheet" crossorigin href="/assets/index-a.css">',
    "</head>",
  ].join("\n");

  it("leaves nothing in the page that is fetched before the first paint except the loader, the theme script and the styles", () => {
    const stripped = withoutStartupTags(page);
    expect(stripped).not.toMatch(/type="module"|modulepreload/);
    expect(stripped).toContain('src="/theme-init.js"');
    expect(stripped).toContain('rel="stylesheet"');
  });

  it("starts the app from a loader that waits for the first paint and falls back to a timer", () => {
    const source = appLoaderSource({
      entry: "/assets/index-a.js",
      preloads: ["/assets/ui-b.js"],
      fonts: ["/assets/face.woff2"],
    });
    expect(source).toContain('"/assets/index-a.js"');
    expect(source).toContain('"/assets/ui-b.js"');
    expect(source).toContain('"/assets/face.woff2"');
    expect(source).toContain('type: "paint"');
    expect(source).toMatch(/setTimeout\(start, \d+\)/);
    expect(() => new Function(source)).not.toThrow();
  });
});

describe("webDelivery", () => {
  it("compresses the build under the Vite root, not the working directory", () => {
    writeFileSync(join(dir, "assets", "app-abc.js"), "export const answer = 42;\n".repeat(200));
    const plugin = webDelivery();
    const configResolved = plugin.configResolved as (config: unknown) => void;
    const closeBundle = plugin.closeBundle as unknown as { handler: () => void };

    configResolved({ root: join(dir, ".."), build: { outDir: basename(dir) }, base: "/" });
    closeBundle.handler();

    expect(readdirSync(join(dir, "assets")).sort()).toEqual([
      "app-abc.js",
      "app-abc.js.br",
      "app-abc.js.gz",
    ]);
  });
});
