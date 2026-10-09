import { LLM_TIMEOUT_MS } from "../../../src/mail/llm.js";
import { describeHardware, waitForIdleGpu } from "../hardware.js";
import { runProduction } from "../pipeline.js";
import { type Candidate, type Item, type Outcome, Skip } from "../types.js";
import { DEFAULT_OLLAMA_MODEL, OLLAMA_URL, ollamaHasModel, unloadOllamaModel } from "./ollama.js";

export interface ProductionOptions {
  model?: string;
  /** Memory the model needs on the GPU, so the wait for a free card is long enough. */
  needMiB?: number;
  log: (message: string) => void;
}

/** (a) The classifier as shipped: rules, then the language model step through its own interface. */
export function productionCandidate(options: ProductionOptions): Candidate {
  const model = options.model ?? DEFAULT_OLLAMA_MODEL;
  return {
    id: "a-rules-llm",
    description: `Rules, then the existing LLM step (askLlm over /v1/chat/completions) with ${model} on Ollama`,
    hardware: "",
    async setup() {
      if (!(await ollamaHasModel(model))) throw new Skip(`Ollama does not have ${model}`);
      this.hardware = await describeHardware();
      await waitForIdleGpu(options.needMiB ?? 8000, options.log);
    },
    async runAll(items: Item[]): Promise<Outcome[]> {
      return runProduction(
        items,
        { baseUrl: `${OLLAMA_URL}/v1`, model, apiKey: null },
        LLM_TIMEOUT_MS,
      );
    },
    async dispose() {
      await unloadOllamaModel(model);
    },
  };
}
