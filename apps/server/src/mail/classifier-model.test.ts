import { outgoingMessageId, ReplyClassification } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { noDkim, signedAs } from "../test-utils/dkim.js";
import { createReplyClassifier } from "./classifier.js";
import type { ModelResult, ReplyModelHost } from "./reply-model/types.js";
import type { ClassifierRequest, InboxMessage } from "./types.js";

const request: ClassifierRequest = {
  id: "req-1",
  open: true,
  targetKind: "broker",
  contactAddress: null,
  sentAt: null,
  reference: "KR-7K3M9Q",
  outgoingMessageId: outgoingMessageId("req-1", "example.com"),
  status: "awaiting_reply",
  channel: "email",
  targetId: "acme",
  targetName: "Acme Data",
  targetDomain: "acme.test",
  replyDomains: ["acme.test"],
  curatedReplyDomains: [],
  replyAddresses: [],
  recordUrl: null,
  awaitingConfirmation: null,
};

/** Wording the rules know nothing about, so only the model has an opinion. */
const VAGUE = "Hmm, interesting. Let me think about it.";

function message(overrides: Partial<InboxMessage> = {}): InboxMessage {
  const base: InboxMessage = {
    uid: 1,
    messageId: "<reply@acme.test>",
    inReplyTo: request.outgoingMessageId,
    references: [],
    from: { name: null, address: "privacy@acme.test" },
    to: ["jordan@example.com"],
    subject: "Your request",
    date: new Date("2026-10-01T12:00:00Z"),
    text: VAGUE,
    html: null,
    isBounce: false,
    autoSubmitted: false,
    headers: {},
    originalMessageIds: [],
    verifyDkim: noDkim,
    ...overrides,
  };
  if (overrides.verifyDkim) return base;
  return {
    ...base,
    verifyDkim: signedAs("acme.test", { inReplyTo: base.inReplyTo ? [base.inReplyTo] : [] }),
  };
}

function answer(label: ReplyClassification, confidence: number, manifestThreshold = 0.961) {
  const probabilities = Object.fromEntries(
    ReplyClassification.options.map((name) => [
      name,
      name === label ? confidence : (1 - confidence) / 9,
    ]),
  ) as Record<ReplyClassification, number>;
  return {
    ok: true,
    answer: { label, confidence, probabilities, version: "v1", manifestThreshold },
  } as const;
}

function host(result: ModelResult | (() => ModelResult | Promise<ModelResult>)) {
  const calls: string[] = [];
  const fake: ReplyModelHost & { calls: string[] } = {
    calls,
    async predict(input) {
      calls.push(input.body);
      return typeof result === "function" ? result() : result;
    },
    status: () => ({ state: "loaded", reason: null, version: "v1", threshold: 0.961 }),
    close: async () => undefined,
  };
  return fake;
}

interface Setup {
  model?: ReplyModelHost | undefined;
  override?: number | null;
  spotCheckPercent?: number;
  paused?: boolean;
  llm?: { baseUrl: string; model: string; apiKey: null } | null;
  fetch?: typeof fetch;
  random?: () => number;
  log?: (reason: string) => void;
}

function classifierWith(setup: Setup) {
  const values: Record<string, unknown> = {
    replyModel: {
      spotCheckPercent: setup.spotCheckPercent ?? 0,
      threshold: setup.override ?? null,
    },
    "replyModel.state": {
      pausedAt: setup.paused ? "2026-10-01T00:00:00.000Z" : null,
      reason: null,
      countedFrom: null,
    },
    llm: setup.llm ?? null,
  };
  return createReplyClassifier({
    settings: { get: ((key: string) => values[key]) as never },
    ...(setup.model ? { model: setup.model } : {}),
    ...(setup.fetch ? { fetch: setup.fetch } : {}),
    ...(setup.random ? { random: setup.random } : {}),
    ...(setup.log ? { log: setup.log } : {}),
  });
}

const classify = (setup: Setup, mail: InboxMessage = message()) =>
  classifierWith(setup).classify(mail, { requests: [request] });

describe("the reply model after the rules", () => {
  it("is not asked when the rules are sure", async () => {
    const model = host(answer("rejected", 0.99));
    const result = await classify({ model }, message({ text: "Your data has been deleted." }));
    expect(model.calls).toHaveLength(0);
    expect(result).toMatchObject({ classification: "completed", source: "rules", apply: true });
    expect(result.prediction.model).toBeNull();
  });

  it("applies a model answer at or above its threshold", async () => {
    const result = await classify({ model: host(answer("no_record", 0.97)) });
    expect(result).toMatchObject({
      requestId: "req-1",
      classification: "no_record",
      confidence: 0.97,
      source: "model",
      apply: true,
      suggestion: null,
    });
    expect(result.prediction).toMatchObject({
      rules: { label: "unknown", confidence: 0.2 },
      model: { version: "v1", label: "no_record", confidence: 0.97 },
    });
    expect(result.prediction.inputSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("only suggests an answer below the threshold, and leaves the rules' answer in place", async () => {
    const result = await classify({ model: host(answer("no_record", 0.9)) });
    expect(result).toMatchObject({
      classification: "unknown",
      confidence: 0.2,
      source: "model",
      apply: false,
      suggestion: {
        classification: "no_record",
        confidence: 0.9,
        source: "model",
        spotCheck: false,
      },
    });
  });

  it("never applies below 0.90 even when the manifest names a lower threshold", async () => {
    const low = host(answer("no_record", 0.85, 0.5));
    expect((await classify({ model: low })).apply).toBe(false);
    const enough = host(answer("no_record", 0.92, 0.5));
    expect((await classify({ model: enough })).apply).toBe(true);
  });

  it("lets the setting raise the threshold above the manifest's", async () => {
    const model = host(answer("no_record", 0.97));
    expect((await classify({ model, override: 0.99 })).apply).toBe(false);
    expect((await classify({ model, override: 0.97 })).apply).toBe(true);
  });

  it("holds an answer to the sender trust cap", async () => {
    const result = await classify(
      { model: host(answer("completed", 0.99)) },
      message({ verifyDkim: noDkim }),
    );
    expect(result).toMatchObject({ apply: false, source: "model" });
    expect(result.suggestion).toMatchObject({ classification: "completed", confidence: 0.99 });
  });

  it("only suggests for mail that matches no request", async () => {
    const result = await classify(
      { model: host(answer("completed", 0.99)) },
      message({
        inReplyTo: null,
        from: { name: null, address: "someone@else.test" },
        subject: "Hello",
        text: "Thank you for your message. We will review it within 3 business days.",
        verifyDkim: noDkim,
      }),
    );
    expect(result.requestId).toBeNull();
    expect(result).toMatchObject({ apply: false, source: "model" });
    expect(result.suggestion?.classification).toBe("completed");
  });

  it("turns a confirmation link with no link on the request's site into unknown", async () => {
    const result = await classify({ model: host(answer("confirmation_link", 0.99)) });
    expect(result).toMatchObject({ classification: "unknown", apply: false, suggestion: null });
    expect(result.prediction.model?.label).toBe("confirmation_link");
  });

  it("keeps the links for a confirmation link on the request's site", async () => {
    const result = await classify(
      { model: host(answer("confirmation_link", 0.99)) },
      message({ text: "Please follow https://acme.test/x/abc123 to proceed." }),
    );
    expect(result).toMatchObject({
      classification: "confirmation_link",
      apply: true,
      links: ["https://acme.test/x/abc123"],
    });
  });

  it("keeps the form links for needs_form and the fields for verification_required", async () => {
    const form = await classify(
      { model: host(answer("needs_form", 0.99)) },
      message({ text: "Hmm. Our form is at https://acme.test/privacy-form if you want it." }),
    );
    expect(form).toMatchObject({ classification: "needs_form", apply: true });
    expect(form.links).toEqual(["https://acme.test/privacy-form"]);

    const verify = await classify(
      { model: host(answer("verification_required", 0.99)) },
      message({ text: "Hmm. Reply with your zip and your phone number." }),
    );
    expect(verify).toMatchObject({ classification: "verification_required", apply: true });
    expect(verify.requestedFields).toEqual(["phone", "zip"]);
  });
});

describe("spot checks", () => {
  it("hold back a sampled share of answers that would have been applied", async () => {
    const model = host(answer("no_record", 0.99));
    const held = await classify({ model, spotCheckPercent: 10, random: () => 0.05 });
    expect(held).toMatchObject({
      classification: "unknown",
      apply: false,
      suggestion: { classification: "no_record", spotCheck: true },
    });
    const applied = await classify({ model, spotCheckPercent: 10, random: () => 0.5 });
    expect(applied.apply).toBe(true);
  });

  it("are switched off at 0 percent", async () => {
    const result = await classify({
      model: host(answer("no_record", 0.99)),
      spotCheckPercent: 0,
      random: () => 0,
    });
    expect(result.apply).toBe(true);
  });

  it("make every answer a spot check while applying is paused", async () => {
    const result = await classify({
      model: host(answer("no_record", 0.99)),
      paused: true,
      random: () => 0.99,
    });
    expect(result).toMatchObject({ apply: false, suggestion: { spotCheck: true } });
  });

  it("do not hold back an answer that was never applicable", async () => {
    const result = await classify({
      model: host(answer("no_record", 0.9)),
      spotCheckPercent: 100,
      random: () => 0,
    });
    expect(result.suggestion?.spotCheck).toBe(false);
  });
});

describe("when the reply model cannot answer", () => {
  const llm = { baseUrl: "http://localhost:11434/v1/", model: "local", apiKey: null };
  const fakeLlm = (calls: string[]) =>
    (async (url: string | URL | Request) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  classification: "rejected",
                  confidence: 0.99,
                  rationale: "They decline",
                  requested_fields: [],
                }),
              },
            },
          ],
        }),
      );
    }) as typeof fetch;

  it("gives exactly the rules' answer when there is no model and no language model", async () => {
    const without = await classify({
      model: host({ ok: false, reason: "No reply model is installed" }),
    });
    const plain = await classify({});
    expect(without).toEqual(plain);
    expect(without).toMatchObject({
      classification: "unknown",
      confidence: 0.2,
      apply: false,
      source: "rules",
    });
  });

  it("falls back to a configured language model, which only suggests", async () => {
    const calls: string[] = [];
    const result = await classify({
      model: host({ ok: false, reason: "timed out" }),
      llm,
      fetch: fakeLlm(calls),
    });
    expect(calls).toHaveLength(1);
    expect(result).toMatchObject({
      classification: "unknown",
      source: "llm",
      apply: false,
      rationale: "Model: They decline",
      suggestion: { classification: "rejected", source: "llm", spotCheck: false },
    });
  });

  it("does not ask the language model when the reply model answered", async () => {
    const calls: string[] = [];
    await classify({ model: host(answer("no_record", 0.5)), llm, fetch: fakeLlm(calls) });
    expect(calls).toHaveLength(0);
  });

  it("survives a host that throws and says why once", async () => {
    const reasons: string[] = [];
    const throwing: ReplyModelHost = {
      predict: async () => {
        throw new Error("boom");
      },
      status: () => ({ state: "loaded", reason: null, version: "v1", threshold: 0.961 }),
      close: async () => undefined,
    };
    const classifier = classifierWith({ model: throwing, log: (reason) => reasons.push(reason) });
    const first = await classifier.classify(message(), { requests: [request] });
    await classifier.classify(message(), { requests: [request] });
    expect(first).toMatchObject({ classification: "unknown", apply: false });
    expect(reasons).toEqual(["The reply model failed: boom"]);
  });
});
