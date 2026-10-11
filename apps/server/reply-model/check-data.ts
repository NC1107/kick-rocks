/**
 * Fails when the dev replies in the repo are no longer the ones the pinned model was trained on.
 *
 *   pnpm --filter @kickrocks/server reply-model:check-data
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { dataSha256, REPLY_MODEL_DIR, rowsOf } from "./data.js";

export const Release = z.object({
  version: z.string(),
  /** Where the release archive is published. Empty until the first release exists. */
  url: z.string(),
  /** Empty, like `dataSha256`, and null for `threshold`, until a release is published and pinned. */
  tarSha256: z.string(),
  dataSha256: z.string(),
  threshold: z.number().nullable(),
});
export type Release = z.infer<typeof Release>;

export function readRelease(): Release {
  return Release.parse(JSON.parse(readFileSync(join(REPLY_MODEL_DIR, "release.json"), "utf8")));
}

async function main(): Promise<void> {
  const release = readRelease();
  if (release.dataSha256 === "") {
    console.log("No release is pinned yet.");
    return;
  }
  const current = dataSha256(await rowsOf("dev"));
  if (current !== release.dataSha256) {
    console.error(
      `The dev replies changed since release ${release.version} was trained.\n  repo:     ${current}\n  manifest: ${release.dataSha256}\nTrain a new release and pin it, or revert the data.`,
    );
    process.exit(1);
  }
  console.log(`The dev replies match release ${release.version} (${current.slice(0, 12)}).`);
}

if (process.argv[1]?.endsWith("check-data.ts")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
