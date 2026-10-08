import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import type { HtmlTagDescriptor, Plugin } from "vite";

const COMPRESSIBLE = new Set([".js", ".css", ".html", ".svg", ".json", ".webmanifest", ".txt"]);

/** Below this a second file costs more in round trips and disk than the bytes it would save. */
const MIN_BYTES = 1024;

/**
 * The Latin faces the signed-in first screens are set in: Sans body, nav and headings, and the Mono
 * logo. The browser finds a face only after the CSS loads, so each one left out swaps in late.
 */
const ABOVE_THE_FOLD_FONT =
  /(IBMPlexSans-(Regular|Medium|SemiBold)|IBMPlexMono-SemiBold)-Latin1-[\w-]+\.woff2$/;

function* filesUnder(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) yield* filesUnder(path);
    else yield path;
  }
}

/**
 * Writes a .br and a .gz next to every text file in a build, so the server can send the stored
 * bytes instead of compressing on each request. A file that does not get smaller is left alone.
 */
export function precompressDirectory(dir: string): number {
  let written = 0;
  for (const path of filesUnder(dir)) {
    if (!COMPRESSIBLE.has(extname(path))) continue;
    const source = readFileSync(path);
    if (source.length < MIN_BYTES) continue;
    const variants = [
      [
        ".br",
        brotliCompressSync(source, {
          params: {
            [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
            [constants.BROTLI_PARAM_SIZE_HINT]: source.length,
          },
        }),
      ],
      [".gz", gzipSync(source, { level: 9 })],
    ] as const;
    for (const [suffix, packed] of variants) {
      if (packed.length >= source.length) continue;
      writeFileSync(path + suffix, packed);
      written += 1;
    }
  }
  return written;
}

export function fontPreloads(fileNames: string[], base: string): HtmlTagDescriptor[] {
  return fileNames
    .filter((fileName) => ABOVE_THE_FOLD_FONT.test(fileName))
    .sort()
    .map((fileName) => ({
      tag: "link",
      // A font request is always anonymous CORS, so a preload without crossorigin is fetched twice.
      attrs: {
        rel: "preload",
        as: "font",
        type: "font/woff2",
        crossorigin: "",
        href: `${base}${fileName}`,
      },
      injectTo: "head",
    }));
}

export function webDelivery(): Plugin {
  let outDir = "";
  let base = "/";
  return {
    name: "kickrocks-web-delivery",
    apply: "build",
    configResolved(config) {
      // Vite leaves outDir relative, and the build can start from any directory.
      outDir = resolve(config.root, config.build.outDir);
      base = config.base;
    },
    transformIndexHtml: {
      order: "post",
      handler(_html, context) {
        return fontPreloads(Object.keys(context.bundle ?? {}), base);
      },
    },
    closeBundle: {
      order: "post",
      handler() {
        precompressDirectory(outDir);
      },
    },
  };
}
