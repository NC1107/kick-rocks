import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const UPSTREAM_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..", "data", "upstream");

const PinnedUpstream = z.object({
  commit: z.string().regex(/^[0-9a-f]{40}$/),
  files: z.record(
    z.string(),
    z.object({ path: z.string(), sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  ),
});

/**
 * Reads a pinned upstream file and refuses one that no longer matches its recorded hash, so a hand
 * edit of the copy cannot pass as the upstream list that the attribution names.
 */
export function readPinnedUpstream(
  name: string,
  { dir = UPSTREAM_DIR, source = "badbool.source.json" } = {},
): string {
  const pin = PinnedUpstream.parse(JSON.parse(readFileSync(resolve(dir, source), "utf8")));
  const expected = pin.files[name]?.sha256;
  if (!expected) throw new Error(`${name} is not listed in ${source}`);
  const text = readFileSync(resolve(dir, name), "utf8");
  const actual = createHash("sha256").update(text).digest("hex");
  if (actual !== expected) {
    throw new Error(`${name} does not match its pinned copy (${expected}); got ${actual}`);
  }
  return text;
}
