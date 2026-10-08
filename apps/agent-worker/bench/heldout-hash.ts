import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const benchDir = dirname(fileURLToPath(import.meta.url));
export const HELDOUT_DIR = join(benchDir, "heldout");
export const HELDOUT_HASH_FILE = join(benchDir, "heldout.sha256");

function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? filesUnder(join(dir, entry.name)) : [join(dir, entry.name)],
    )
    .sort();
}

/**
 * One digest over every file's relative path and content, so a renamed, added, removed or edited
 * held-out file all change it. Each file is hashed first so a path can never run into content.
 */
export function hashDirectory(dir: string): string {
  const outer = createHash("sha256");
  for (const file of filesUnder(dir)) {
    const content = createHash("sha256").update(readFileSync(file)).digest("hex");
    outer.update(`${relative(dir, file).split("\\").join("/")}\0${content}\n`);
  }
  return outer.digest("hex");
}

export function recordedHeldoutHash(): string {
  return readFileSync(HELDOUT_HASH_FILE, "utf8").trim().split(/\s+/)[0] ?? "";
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const digest = hashDirectory(HELDOUT_DIR);
  if (process.argv.includes("--write")) {
    writeFileSync(HELDOUT_HASH_FILE, `${digest}  heldout/\n`);
    console.log(`Recorded ${digest} in ${HELDOUT_HASH_FILE}`);
  } else {
    console.log(digest);
    console.log(
      digest === recordedHeldoutHash() ? "Matches the record." : "Differs from the record.",
    );
  }
}
