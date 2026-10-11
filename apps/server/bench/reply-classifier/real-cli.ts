import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createReplyModelHost } from "../../src/mail/reply-model/host.js";
import { OLLAMA_URL, ollamaHasModel, unloadOllamaModel } from "./candidates/ollama.js";
import { describeHardware, waitForIdleGpu } from "./hardware.js";
import { loadRealReplies, sourceUrls } from "./real-corpus.js";
import {
  type ApproachResult,
  type RealReport,
  renderRealReport,
  summarize,
} from "./real-report.js";
import {
  classifyReplies,
  type NameScenario,
  type RealApproach,
  systemPromptAt,
} from "./real-run.js";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = join(here, "..", "..", "..", "..");
const LLM_NEED_MIB = 14000;

export interface RealOptions {
  corpus: string;
  approaches: string[];
  models: string[];
  releaseDir: string | null;
  tunedRef: string;
  thinkingOff: boolean;
  out: string;
  log: (message: string) => void;
}

interface Planned {
  name: string;
  description: string;
  /** The Ollama model to keep resident and free afterwards, when there is one. */
  ollamaModel: string | null;
  build: () => Promise<{ approach: RealApproach; close: () => Promise<void> }>;
}

function plan(options: RealOptions): Planned[] {
  const planned: Planned[] = [];
  const llm = (model: string, systemPrompt: string | null) => ({
    baseUrl: `${OLLAMA_URL}/v1`,
    model,
    systemPrompt,
    thinkingOff: options.thinkingOff,
  });
  for (const id of options.approaches) {
    if (id === "rules") {
      planned.push({
        name: "rules",
        description: "The rules alone, with the name gate as on this branch",
        ollamaModel: null,
        build: async () => ({ approach: {}, close: async () => {} }),
      });
    } else if (id === "encoder") {
      if (!options.releaseDir) throw new Error("--release-dir is needed for the encoder");
      const dir = options.releaseDir;
      planned.push({
        name: "rules + encoder",
        description: `Rules, then the reply model release in ${dir} through the server's own runtime`,
        ollamaModel: null,
        build: async () => {
          const model = createReplyModelHost({ dir, log: options.log });
          return { approach: { model }, close: () => model.close() };
        },
      });
    } else if (id === "llm" || id === "llm-tuned") {
      const tuned = id === "llm-tuned";
      for (const model of options.models) {
        planned.push({
          name: `rules + ${tuned ? "tuned" : "current"} prompt, ${model}`,
          description: tuned
            ? `Rules, then the language model step with the system prompt of ${options.tunedRef}`
            : "Rules, then the language model step as this branch ships it",
          ollamaModel: model,
          build: async () => ({
            approach: {
              llm: llm(model, tuned ? systemPromptAt(options.tunedRef, REPO_DIR) : null),
            },
            close: async () => {},
          }),
        });
      }
    } else {
      throw new Error(`Unknown approach "${id}"; use rules, encoder, llm or llm-tuned`);
    }
  }
  return planned;
}

export async function runRealCorpus(options: RealOptions): Promise<string> {
  const replies = loadRealReplies(options.corpus);
  const support: Record<string, number> = {};
  for (const reply of replies) support[reply.truth] = (support[reply.truth] ?? 0) + 1;
  const results: ApproachResult[] = [];

  for (const step of plan(options)) {
    options.log(`Running ${step.name}`);
    if (step.ollamaModel !== null) {
      if (!(await ollamaHasModel(step.ollamaModel))) {
        options.log(`Ollama does not have ${step.ollamaModel}, skipped`);
        continue;
      }
      await waitForIdleGpu(LLM_NEED_MIB, options.log);
    }
    const { approach, close } = await step.build();
    try {
      const scenarios = {} as Record<NameScenario, ReturnType<typeof summarize>>;
      for (const scenario of ["named", "unnamed"] as const) {
        options.log(` ${scenario}`);
        scenarios[scenario] = summarize(
          await classifyReplies(replies, scenario, approach, options.log),
        );
      }
      results.push({ name: step.name, description: step.description, scenarios });
    } finally {
      await close();
      if (step.ollamaModel !== null) await unloadOllamaModel(step.ollamaModel);
    }
  }

  const report: RealReport = {
    startedAt: new Date().toISOString(),
    hardware: await describeHardware(),
    count: replies.length,
    support,
    notes: [
      `Models: ${options.models.join(", ") || "none"}; thinking ${options.thinkingOff ? "off" : "on"}.`,
      ...results.map((result) => `${result.name}: ${result.description}.`),
    ],
    results,
  };
  mkdirSync(options.out, { recursive: true });
  const stamp = report.startedAt.replaceAll(/[:.]/g, "-");
  const markdown = renderRealReport(report);
  writeFileSync(join(options.out, `real-${stamp}.json`), JSON.stringify(report, null, 2));
  writeFileSync(join(options.out, `real-${stamp}.md`), `${markdown}\n`);
  writeFileSync(
    join(options.out, "real-replies-sources.txt"),
    `${sourceUrls(replies).join("\n")}\n`,
  );
  return markdown;
}
