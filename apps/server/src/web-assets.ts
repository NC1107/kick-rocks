import { relative, sep } from "node:path";
import type { FastifyStaticOptions } from "@fastify/static";

const ONE_YEAR_SECONDS = 31_536_000;

/**
 * Vite puts a content hash in the name of everything under assets/, so those files can be kept
 * forever. Every other file keeps its name from build to build, so a browser has to ask again
 * (an ETag makes that a cheap 304) or an upgrade would keep serving the old entry page.
 */
export function webAssetOptions(root: string): FastifyStaticOptions {
  return {
    root,
    wildcard: false,
    // The build writes a .br and a .gz next to each compressible file.
    preCompressed: true,
    setHeaders(reply, path) {
      const [first] = relative(root, path).split(sep);
      reply.header(
        "cache-control",
        first === "assets" ? `public, max-age=${ONE_YEAR_SECONDS}, immutable` : "no-cache",
      );
    },
  };
}
