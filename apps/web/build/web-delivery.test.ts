import { randomBytes } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { fileURLToPath } from "node:url";
import { brotliDecompressSync, gunzipSync } from "node:zlib";
import { build } from "vite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { fontPreloads, precompressDirectory, webDelivery } from "./web-delivery.js";

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
  it("preloads the Latin Plex Sans Regular, Medium and SemiBold faces and the Mono SemiBold logo face, as anonymous CORS", () => {
    const tags = fontPreloads(
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
    expect(tags.map((tag) => (tag.attrs as Record<string, string>).href)).toEqual([
      "/assets/IBMPlexMono-SemiBold-Latin1-ChfWfxA6.woff2",
      "/assets/IBMPlexSans-Medium-Latin1-B2CuUu4P.woff2",
      "/assets/IBMPlexSans-Regular-Latin1-BUjEsRx4.woff2",
      "/assets/IBMPlexSans-SemiBold-Latin1-CIhZjzyK.woff2",
    ]);
    expect(tags[0]?.attrs).toMatchObject({ rel: "preload", as: "font", crossorigin: "" });
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

describe("the built page", () => {
  const webDir = fileURLToPath(new URL("..", import.meta.url));
  let outDir: string;

  afterEach(() => rmSync(outDir, { recursive: true, force: true }));

  it("starts the app from files that exist in the build", async () => {
    outDir = mkdtempSync(join(tmpdir(), "kickrocks-build-"));
    await build({
      root: webDir,
      configFile: join(webDir, "vite.config.ts"),
      logLevel: "silent",
      build: { outDir, emptyOutDir: true },
    });

    const html = readFileSync(join(outDir, "index.html"), "utf8");
    const referenced = (pattern: RegExp) =>
      [...html.matchAll(pattern)].map((match) => match[1] ?? "");
    const modules = referenced(/<script type="module"[^>]*src="([^"]+)"/g);
    expect(modules).toHaveLength(1);
    const files = [
      ...modules,
      ...referenced(/<link rel="modulepreload"[^>]*href="([^"]+)"/g),
      ...referenced(/<link rel="stylesheet"[^>]*href="([^"]+)"/g),
      // The sign-in check is preloaded as an API request, which is not a file of the build.
      ...referenced(/<link rel="preload"[^>]*href="([^"]+)"/g).filter(
        (href) => href !== "/api/auth/state",
      ),
    ];
    expect(files.length).toBeGreaterThan(modules.length);
    for (const file of files) {
      expect(file).toMatch(/^\/assets\/[\w.-]+$/);
      expect(existsSync(join(outDir, file)), file).toBe(true);
    }
    expect(files.filter((file) => file.endsWith(".woff2"))).toHaveLength(4);
  }, 120_000);
});
