import { describe, expect, it } from "vitest";
import { parseOllamaPs } from "../hardware.js";
import { LABELS } from "../labels.js";
import { Skip } from "../types.js";
import { trainingKey } from "./encoder.js";
import { jevCandidate, jevModel, jevRequestBody, predictionFromJev } from "./jev.js";
import { distributionFromLogprobs, LABEL_LETTERS, ollamaLabelScorer } from "./label-scoring.js";
import { HYPOTHESES } from "./nli.js";

const letterOf = (label: string) =>
  [...LABEL_LETTERS].find(([, value]) => value === label)?.[0] ?? "";

describe("label scoring", () => {
  it("gives every class its own letter", () => {
    expect(LABEL_LETTERS.size).toBe(LABELS.length);
  });

  it("normalizes over the class letters and drops other tokens", () => {
    const distribution = distributionFromLogprobs([
      { token: letterOf("completed"), logprob: Math.log(0.6) },
      { token: ` ${letterOf("rejected")}`, logprob: Math.log(0.2) },
      { token: "The", logprob: Math.log(0.15) },
    ]);
    expect(distribution?.completed).toBeCloseTo(0.75);
    expect(distribution?.rejected).toBeCloseTo(0.25);
    const total = Object.values(distribution ?? {}).reduce((sum, value) => sum + value, 0);
    expect(total).toBeCloseTo(1);
  });

  it("returns nothing when no class letter was among the alternatives", () => {
    expect(distributionFromLogprobs([{ token: "Sure", logprob: -0.1 }])).toBeNull();
  });

  it("asks Ollama for one token and its alternatives, and reads the answer", async () => {
    let sent: Record<string, unknown> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          logprobs: [
            {
              token: letterOf("needs_form"),
              logprob: -0.1,
              top_logprobs: [
                { token: letterOf("needs_form"), logprob: Math.log(0.9) },
                { token: letterOf("auto_ack"), logprob: Math.log(0.1) },
              ],
            },
          ],
        }),
      );
    }) as unknown as typeof fetch;
    const prediction = await ollamaLabelScorer("m", fetchImpl).predict({ subject: "s", body: "b" });
    expect(sent).toMatchObject({ logprobs: true, think: false, options: { num_predict: 1 } });
    expect(prediction).toMatchObject({ label: "needs_form" });
    expect(prediction?.confidence).toBeCloseTo(0.9);
  });

  it("gives up quietly when the server returns no logprobs", async () => {
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ message: { content: "A" } }))) as unknown as typeof fetch;
    expect(await ollamaLabelScorer("m", fetchImpl).predict({ subject: "s", body: "b" })).toBeNull();
  });
});

describe("Jev", () => {
  it("sends the reply as state with one Choice question over every class", () => {
    const body = jevRequestBody({ subject: "Re: request", body: "We deleted it." });
    expect(body.state).toContain("We deleted it.");
    const question = body.questions.reply;
    expect(question.type).toBe("choice");
    expect(Object.keys(question.criteria)).toEqual([...LABELS]);
  });

  it("reads probabilities into a prediction and ignores names that are not classes", () => {
    const prediction = predictionFromJev({
      type: "choice",
      choice: "completed",
      probabilities: { completed: 0.8, rejected: 0.15, other: 0.05 },
    });
    expect(prediction).toMatchObject({ label: "completed", confidence: 0.8 });
    expect(prediction?.probabilities).not.toHaveProperty("other");
  });

  it("authenticates with a bearer key and returns null on an error status", async () => {
    let headers: Record<string, string> = {};
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      headers = init.headers as Record<string, string>;
      return new Response("nope", { status: 401 });
    }) as unknown as typeof fetch;
    expect(await jevModel("key", fetchImpl).predict({ subject: "s", body: "b" })).toBeNull();
    expect(headers.authorization).toBe("Bearer key");
  });

  it("skips cleanly without TYPESAFE_API_KEY", async () => {
    await expect(jevCandidate({}).setup([])).rejects.toBeInstanceOf(Skip);
    await expect(jevCandidate({}).setup([])).rejects.toThrow("TYPESAFE_API_KEY");
  });
});

describe("zero-shot NLI", () => {
  it("has a hypothesis for every class", () => {
    expect(Object.keys(HYPOTHESES).sort()).toEqual([...LABELS].sort());
  });
});

describe("encoder training", () => {
  const item = (truth: "completed" | "rejected", body: string) =>
    ({
      id: body,
      source: "tuning",
      split: "dev",
      truth,
      subject: "s",
      body,
      fromAddress: "a@b.c",
      raw: null,
    }) as const;

  it("changes its cache key when the training items or the model change", () => {
    const base = [item("completed", "one"), item("rejected", "two")];
    const key = trainingKey("m", base);
    expect(trainingKey("m", base)).toBe(key);
    expect(trainingKey("other", base)).not.toBe(key);
    expect(trainingKey("m", [...base, item("rejected", "three")])).not.toBe(key);
    expect(trainingKey("m", [item("rejected", "one"), item("rejected", "two")])).not.toBe(key);
  });
});

describe("ollama ps parsing", () => {
  it("lists the loaded model names", () => {
    const output = `NAME           ID    SIZE   PROCESSOR   CONTEXT   UNTIL\nqwen3:14b      bdbd  11 GB  100% GPU    16384     4 minutes from now\n`;
    expect(parseOllamaPs(output)).toEqual(["qwen3:14b"]);
    expect(parseOllamaPs("NAME ID SIZE PROCESSOR CONTEXT UNTIL\n")).toEqual([]);
  });
});
