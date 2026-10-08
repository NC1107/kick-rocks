import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { brotliCompressSync, constants, gzipSync } from "node:zlib";
import type { Plugin } from "vite";

interface BundleChunk {
  type: string;
  fileName: string;
  isEntry?: boolean;
  imports?: string[];
}

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

export function fontFiles(fileNames: string[], base: string): string[] {
  return fileNames
    .filter((fileName) => ABOVE_THE_FOLD_FONT.test(fileName))
    .sort()
    .map((fileName) => `${base}${fileName}`);
}

/** The entry chunk and every chunk it imports statically, in the order the page needs them. */
export function entryChunks(bundle: Record<string, BundleChunk>): {
  entry: string;
  preloads: string[];
} {
  const entryChunk = Object.values(bundle).find((chunk) => chunk.type === "chunk" && chunk.isEntry);
  if (!entryChunk) throw new Error("the build has no entry chunk to start");
  const preloads: string[] = [];
  const queue = [...(entryChunk.imports ?? [])];
  for (let name = queue.shift(); name !== undefined; name = queue.shift()) {
    if (preloads.includes(name) || name === entryChunk.fileName) continue;
    preloads.push(name);
    queue.push(...(bundle[name]?.imports ?? []));
  }
  return { entry: entryChunk.fileName, preloads };
}

/**
 * Source of the script that starts the app once the page has painted. A simulated slow phone
 * counts every file requested before the first paint against it, and the CSP rules out an inline
 * script, so this is a small file of its own. The timer covers a tab that never paints, such as
 * one opened in the background.
 */
export function appLoaderSource(files: {
  entry: string;
  preloads: string[];
  fonts: string[];
}): string {
  return `(function () {
  var started = false;
  function add(tag, attributes) {
    var element = document.createElement(tag);
    for (var name in attributes) element.setAttribute(name, attributes[name]);
    document.head.appendChild(element);
  }
  function start() {
    if (started) return;
    started = true;
    ${JSON.stringify(files.fonts)}.forEach(function (href) {
      add("link", { rel: "preload", as: "font", type: "font/woff2", crossorigin: "", href: href });
    });
    ${JSON.stringify(files.preloads)}.forEach(function (href) {
      add("link", { rel: "modulepreload", crossorigin: "", href: href });
    });
    add("script", { type: "module", crossorigin: "", src: ${JSON.stringify(files.entry)} });
  }
  try {
    new PerformanceObserver(start).observe({ type: "paint", buffered: true });
  } catch (_) {
    start();
  }
  setTimeout(start, 1500);
})();
`;
}

/** Takes the tags that start the app out of the page, since the loader adds them after first paint. */
export function withoutStartupTags(html: string): string {
  return html
    .replace(/\s*<script type="module"[^>]*><\/script>/g, "")
    .replace(/\s*<link rel="modulepreload"[^>]*>/g, "");
}

export function webDelivery(): Plugin {
  let outDir = "";
  let base = "/";
  let loaderPath = "";
  return {
    name: "kickrocks-web-delivery",
    apply: "build",
    configResolved(config) {
      // Vite leaves outDir relative, and the build can start from any directory.
      outDir = resolve(config.root, config.build.outDir);
      base = config.base;
    },
    generateBundle: {
      order: "pre",
      handler(_options, bundle) {
        const files = entryChunks(bundle as Record<string, BundleChunk>);
        const loader = appLoaderSource({
          entry: `${base}${files.entry}`,
          preloads: files.preloads.map((name) => `${base}${name}`),
          fonts: fontFiles(Object.keys(bundle), base),
        });
        loaderPath = this.getFileName(
          this.emitFile({ type: "asset", name: "app-loader.js", source: loader }),
        );
      },
    },
    transformIndexHtml: {
      order: "post",
      handler(html) {
        return withoutStartupTags(html).replace(
          "</head>",
          `  <script defer src="${base}${loaderPath}"></script>\n  </head>`,
        );
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
