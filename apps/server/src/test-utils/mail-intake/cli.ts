import { writeFileSync } from "node:fs";
import type { CorpusSet } from "./corpus.js";
import { runIntake } from "./harness.js";

/**
 * Prints how well the inbox poll separates mail about a request from everything else. The
 * held-out set is for a final check, so it is only read when asked for by name.
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const splitIndex = args.indexOf("--split");
  const split = splitIndex === -1 ? null : args[splitIndex + 1];
  const set: CorpusSet = args.includes("--held-out") || split === "heldout" ? "held-out" : "dev";
  const verbose = args.includes("--verbose");
  const outIndex = args.indexOf("--out");
  const out = outIndex === -1 ? null : args[outIndex + 1];

  const result = await runIntake(set);

  console.log(
    `${result.set}: ${result.total} messages (${result.ignoreMail} to ignore, ${result.requestMail} about a request)`,
  );
  console.log(JSON.stringify(result.metrics));
  const { verdicts: _verdicts, ...extra } = result.extra;
  console.log(JSON.stringify(extra));
  console.table(
    result.categories.map(
      ({ category, total, falsePositives, falseNegatives, storedIgnored, misrouted }) => ({
        category,
        total,
        falsePositives,
        falseNegatives,
        storedIgnored,
        misrouted,
      }),
    ),
  );
  if (verbose) {
    for (const failure of result.failures) {
      console.log(`${failure.problem.padEnd(15)} ${failure.file}  ${failure.detail}`);
    }
  }
  if (out) writeFileSync(out, `${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
