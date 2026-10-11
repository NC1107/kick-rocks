/**
 * Runs a release through the server's own runtime and compares it with the golden fixture:
 * the same answer and every probability within the fixture's tolerance.
 *
 *   pnpm --filter @kickrocks/server reply-model:verify --dir <folder with manifest.json>
 */
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ReplyClassification } from "@kickrocks/shared";
import { z } from "zod";
import { createReplyModelHost } from "../src/mail/reply-model/host.js";
import { readManifest } from "../src/mail/reply-model/manifest.js";
import { REPLY_MODEL_DIR } from "./data.js";

const Golden = z.object({
  version: z.string(),
  modelSha256: z.string(),
  tolerance: z.number(),
  cases: z.array(
    z.object({
      text: z.string(),
      label: ReplyClassification,
      probabilities: z.record(ReplyClassification, z.number()),
    }),
  ),
});

export interface Mismatch {
  text: string;
  reason: string;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      dir: { type: "string" },
      golden: { type: "string", default: join(REPLY_MODEL_DIR, "golden.json") },
    },
  });
  if (!values.dir) throw new Error("Pass --dir with the folder that holds manifest.json");
  const dir = resolve(values.dir);
  const golden = Golden.parse(JSON.parse(readFileSync(values.golden as string, "utf8")));
  const read = readManifest(dir);
  if (!read.ok) throw new Error(read.reason);
  if (read.manifest.files["model.onnx"]?.sha256 !== golden.modelSha256) {
    throw new Error("The golden fixture is for a different model than the one in this folder");
  }

  const host = createReplyModelHost({ dir });
  const problems: Mismatch[] = [];
  let worst = 0;
  try {
    for (const expected of golden.cases) {
      const result = await host.predict(splitText(expected.text));
      if (!result.ok) {
        problems.push({ text: expected.text, reason: result.reason });
        continue;
      }
      if (result.answer.label !== expected.label) {
        problems.push({
          text: expected.text,
          reason: `answered ${result.answer.label}, expected ${expected.label}`,
        });
      }
      for (const label of ReplyClassification.options) {
        const difference = Math.abs(
          (result.answer.probabilities[label] ?? 0) - (expected.probabilities[label] ?? 0),
        );
        worst = Math.max(worst, difference);
        if (difference > golden.tolerance) {
          problems.push({ text: expected.text, reason: `${label} differs by ${difference}` });
        }
      }
    }
  } finally {
    await host.close();
  }
  console.log(
    JSON.stringify({ cases: golden.cases.length, worstDifference: worst, problems }, null, 2),
  );
  if (problems.length > 0) process.exit(1);
}

/** Splits "Subject: x\n\nbody" back into the two parts the host puts together again. */
function splitText(text: string): { subject: string; body: string } {
  const match = /^Subject: ([^\n]*)\n\n([\s\S]*)$/.exec(text);
  if (!match) throw new Error("A golden text must start with a Subject line");
  return { subject: match[1] as string, body: match[2] as string };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
