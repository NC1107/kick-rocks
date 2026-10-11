/**
 * Builds a reply model release: trains on the dev replies, picks the threshold from out-of-fold
 * answers, exports to ONNX, reads held-out once, and writes the manifest and the archive.
 *
 *   pnpm --filter @kickrocks/server reply-model:build --version v1
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { ReplyClassification } from "@kickrocks/shared";
import { loadModel, softmax } from "../src/mail/reply-model/runtime.js";
import {
  dataSha256,
  fileSha256,
  leftToModel,
  loadRecipe,
  REPLY_MODEL_DIR,
  type Row,
  rowsOf,
} from "./data.js";
import {
  buildManifest,
  describeFiles,
  packRelease,
  type SplitMetrics,
  writeManifest,
} from "./release.js";
import { type Answer, accuracyOf, atThreshold, chooseThreshold } from "./threshold.js";

const LABELS = ReplyClassification.options;

function log(message: string): void {
  console.error(message);
}

function python(args: string[]): Promise<void> {
  const interpreter = join(REPLY_MODEL_DIR, ".venv", "bin", "python");
  if (!existsSync(interpreter)) {
    throw new Error(
      "The Python environment is missing. Create it with: pnpm --filter @kickrocks/server reply-model:env",
    );
  }
  return new Promise((resolveRun, reject) => {
    const child = spawn(interpreter, [join(REPLY_MODEL_DIR, "model.py"), ...args], {
      stdio: ["ignore", "inherit", "inherit"],
      // The ONNX runtime ships usage telemetry on Linux, and nothing here may leave the machine.
      env: { ...process.env, TOKENIZERS_PARALLELISM: "false", ORT_DISABLE_TELEMETRY: "1" },
    });
    child.on("close", (code) =>
      code === 0 ? resolveRun() : reject(new Error(`model.py ${args[0]} exited with code ${code}`)),
    );
  });
}

function probabilitiesOf(
  logits: number[],
  temperature: number,
): Record<ReplyClassification, number> {
  const probs = softmax(logits, temperature);
  return Object.fromEntries(LABELS.map((label, index) => [label, probs[index] ?? 0])) as Record<
    ReplyClassification,
    number
  >;
}

function argmax(probabilities: Record<ReplyClassification, number>): ReplyClassification {
  let best = LABELS[0] as ReplyClassification;
  for (const label of LABELS) if (probabilities[label] > probabilities[best]) best = label;
  return best;
}

function answerOf(row: Row, probabilities: Record<ReplyClassification, number>): Answer {
  const label = argmax(probabilities);
  return { truth: row.label, label, confidence: probabilities[label] };
}

function metricsOf(answers: readonly Answer[], threshold: number): SplitMetrics {
  return {
    replies: answers.length,
    accuracy: accuracyOf(answers),
    atThreshold: atThreshold(answers, threshold),
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    options: {
      version: { type: "string", default: "v1" },
      work: { type: "string", default: join(REPLY_MODEL_DIR, "work") },
      out: { type: "string", default: join(REPLY_MODEL_DIR, "dist") },
      reuse: { type: "boolean", default: false },
      "dump-only": { type: "boolean", default: false },
    },
  });
  const version = values.version as string;
  const work = resolve(values.work as string);
  const out = resolve(values.out as string);
  const recipe = loadRecipe();
  mkdirSync(work, { recursive: true });
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  log("1. Dumping the dev replies with the rules' answers");
  const dev = await rowsOf("dev");
  const digest = dataSha256(dev);
  writeFileSync(
    join(work, "train.json"),
    JSON.stringify({
      labels: LABELS,
      items: dev.map(({ id, text, label }) => ({ id, text, label })),
    }),
  );
  writeFileSync(join(work, "dev-rules.json"), JSON.stringify(dev));
  log(`   ${dev.length} replies, ${leftToModel(dev).length} left to the model, digest ${digest}`);

  if (values["dump-only"]) return;

  const calibrationPath = join(work, "calibration.json");
  const trained =
    values.reuse &&
    existsSync(calibrationPath) &&
    existsSync(join(work, "dev-digest.txt")) &&
    readFileSync(join(work, "dev-digest.txt"), "utf8") === digest;
  if (trained) {
    log("2-4. Reusing the folds, temperature and final model trained on this data");
  } else {
    log(
      `2-4. Training: ${recipe.folds} folds, the temperature, and the final model (${recipe.device})`,
    );
    await python([
      "train",
      "--train",
      join(work, "train.json"),
      "--out",
      work,
      "--device",
      recipe.device,
    ]);
    writeFileSync(join(work, "dev-digest.txt"), digest);
  }
  const calibration = JSON.parse(readFileSync(calibrationPath, "utf8")) as {
    temperature: number;
    labels: string[];
    libraries: Record<string, string>;
    out_of_fold: { logits: number[][] };
  };
  if (calibration.labels.join() !== LABELS.join()) {
    throw new Error("The trained model's labels are not this server's classifications");
  }

  log("5. Choosing the threshold from out-of-fold answers on replies the rules leave");
  const oofRows: Array<{ row: Row; answer: Answer }> = dev.flatMap((row, index) =>
    row.rulesConfidence < 0.6
      ? [
          {
            row,
            answer: answerOf(
              row,
              probabilitiesOf(calibration.out_of_fold.logits[index] ?? [], calibration.temperature),
            ),
          },
        ]
      : [],
  );
  const oofAnswers = oofRows.map(({ answer }) => answer);
  const chosen = chooseThreshold(oofAnswers, recipe.precisionTarget, recipe.minAnswers);
  if (!chosen) {
    throw new Error(
      `No threshold keeps ${recipe.precisionTarget * 100}% precision with ${recipe.minAnswers} answers, so there is nothing to release`,
    );
  }
  log(
    `   threshold ${chosen.threshold.toFixed(4)}: ${chosen.correct} of ${chosen.answers} right out of fold`,
  );

  log("6. Exporting to ONNX and checking it against PyTorch");
  const heldout = await rowsOf("heldout");
  const checkTexts = join(work, "parity-texts.json");
  writeFileSync(checkTexts, JSON.stringify([...dev, ...heldout].map((row) => row.text)));
  await python([
    "export",
    "--checkpoint",
    join(work, "checkpoint"),
    "--out",
    out,
    "--check",
    checkTexts,
  ]);
  for (const extra of ["parity.json"]) rmSync(join(out, extra), { force: true });
  for (const name of ["tokenizer_config.json", "tokenizer.json"]) {
    if (!existsSync(join(out, name))) throw new Error(`The export left no ${name}`);
  }

  const files = await describeFiles(out);
  const manifestInputs = {
    version,
    recipe,
    labels: LABELS,
    temperature: calibration.temperature,
    threshold: chosen.threshold,
    dataSha256: digest,
    scriptSha256: fileSha256(
      join(REPLY_MODEL_DIR, "model.py"),
      join(REPLY_MODEL_DIR, "recipe.json"),
    ),
    lockfileSha256: fileSha256(join(REPLY_MODEL_DIR, "requirements.lock")),
    libraries: calibration.libraries,
    outOfFold: metricsOf(oofAnswers, chosen.threshold),
    files,
  };

  log("7. Reading held-out once, through the runtime the server uses");
  const provisional = buildManifest({
    ...manifestInputs,
    heldout: { replies: 0, accuracy: 0, atThreshold: atThreshold([], 1) },
  });
  const model = await loadModel(out, provisional, recipe.threads);
  const heldoutAnswers: Answer[] = [];
  for (const row of leftToModel(heldout)) {
    heldoutAnswers.push(answerOf(row, named(await model.probabilities(row.text))));
  }
  const heldoutMetrics = metricsOf(heldoutAnswers, chosen.threshold);
  log(
    `   held-out: ${heldoutMetrics.atThreshold.correct} of ${heldoutMetrics.atThreshold.answers} right at the threshold`,
  );
  const precision = heldoutMetrics.atThreshold.precision;
  if (precision !== null && precision < recipe.heldoutFloor) {
    throw new Error(
      `Held-out precision at the threshold is ${(precision * 100).toFixed(1)}%, under the ${recipe.heldoutFloor * 100}% sanity floor. Do not tune on held-out; look at the recipe or the data.`,
    );
  }

  log("8. Writing the golden fixture the parity check compares against");
  const texts = JSON.parse(
    readFileSync(join(REPLY_MODEL_DIR, "golden-texts.json"), "utf8"),
  ) as string[];
  writeFileSync(join(work, "golden-texts.json"), JSON.stringify(texts));
  await python([
    "logits",
    "--checkpoint",
    join(work, "checkpoint"),
    "--texts",
    join(work, "golden-texts.json"),
    "--out",
    join(work, "golden-logits.json"),
  ]);
  const goldenLogits = JSON.parse(
    readFileSync(join(work, "golden-logits.json"), "utf8"),
  ) as number[][];
  const golden = {
    version,
    modelSha256: files["model.onnx"]?.sha256,
    tolerance: 1e-4,
    cases: texts.map((text, index) => {
      const probabilities = probabilitiesOf(goldenLogits[index] ?? [], calibration.temperature);
      return { text, label: argmax(probabilities), probabilities };
    }),
  };
  writeFileSync(join(out, "golden.json"), `${JSON.stringify(golden, null, 2)}\n`);

  // Dev answers in the bench are these out-of-fold ones, never the final model's own fit.
  writeFileSync(
    join(out, "dev-oof.json"),
    JSON.stringify({
      temperature: calibration.temperature,
      items: dev.map((row, index) => ({
        text: row.text,
        logits: calibration.out_of_fold.logits[index],
      })),
    }),
  );

  log("9. Writing the manifest and the archive");
  const manifest = buildManifest({ ...manifestInputs, heldout: heldoutMetrics });
  writeManifest(out, manifest);
  const tar = join(out, `reply-model-${version}.tar`);
  const tarSha = await packRelease(out, tar);
  writeFileSync(`${tar}.sha256`, `${tarSha}  reply-model-${version}.tar\n`);
  console.log(
    JSON.stringify({ version, tar, sha256: tarSha, threshold: chosen.threshold }, null, 2),
  );
}

function named(probabilities: number[]): Record<ReplyClassification, number> {
  return Object.fromEntries(
    LABELS.map((label, index) => [label, probabilities[index] ?? 0]),
  ) as Record<ReplyClassification, number>;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
