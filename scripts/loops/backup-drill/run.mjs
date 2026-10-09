// Prints the backup drill's result as JSON. The score is the number of failing items, so lower is better and 0 meets the target.
//   pnpm loop:backup-drill                run the migration ladder and the Docker drill
//   pnpm loop:backup-drill --no-docker    run the migration ladder alone
import { runDrill } from "./drill.mjs";
import { runLadder } from "./ladder.mjs";

const withDocker = !process.argv.includes("--no-docker");

const ladder = await runLadder();
const drill = withDocker ? await runDrill() : { metrics: { skipped: true }, failing: [] };
const failing = [...ladder.failing, ...drill.failing];

console.log(
  JSON.stringify(
    {
      score: failing.length,
      targetMet: failing.length === 0 && withDocker,
      failing,
      ladder,
      drill: drill.metrics,
    },
    null,
    2,
  ),
);
