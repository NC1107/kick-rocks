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
  llm?: { baseUrl: string; model: string; apiKey: null } | null;
  fetch?: typeof fetch;
  log?: (reason: string) => void;
}

function classifierWith(setup: Setup) {
  const values: Record<string, unknown> = { llm: setup.llm ?? null };
  return createReplyClassifier({
    settings: { get: ((key: string) => values[key]) as never },
    ...(setup.model ? { model: setup.model } : {}),
    ...(setup.fetch ? { fetch: setup.fetch } : {}),
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

  it("is not asked when the rules are sure of a reading that only suggests", async () => {
    const model = host(answer("rejected", 0.99));
    const result = await classify(
      { model },
      message({ text: "We were unable to locate any record of you." }),
    );
    expect(model.calls).toHaveLength(0);
    expect(result).toMatchObject({
      classification: "no_record",
      source: "rules",
      apply: false,
      suggestion: { classification: "no_record", source: "rules", spotCheck: false },
    });
  });

  it("never applies a model answer, however sure it is, and hands it to Review as a suggestion", async () => {
    const result = await classify({ model: host(answer("no_record", 0.99)) });
    expect(result).toMatchObject({
      requestId: "req-1",
      classification: "unknown",
      confidence: 0.2,
      source: "model",
      apply: false,
      suggestion: {
        classification: "no_record",
        confidence: 0.99,
        source: "model",
        spotCheck: false,
      },
    });
    expect(result.prediction).toMatchObject({
      rules: { label: "unknown", confidence: 0.2 },
      model: { version: "v1", label: "no_record", confidence: 0.99 },
    });
    expect(result.prediction.inputSha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("suggests the same way at a lower confidence", async () => {
    const result = await classify({ model: host(answer("no_record", 0.9)) });
    expect(result).toMatchObject({
      classification: "unknown",
      confidence: 0.2,
      source: "model",
      apply: false,
      suggestion: { classification: "no_record", confidence: 0.9, source: "model" },
    });
  });

  it("holds an answer to the sender trust cap", async () => {
    const result = await classify(
      { model: host(answer("completed", 0.99)) },
      message({ verifyDkim: noDkim }),
    );
    expect(result).toMatchObject({ apply: false, source: "model" });
    expect(result.suggestion).toMatchObject({ classification: "completed", confidence: 0.99 });
  });

  it("does not let a model downgrade overrule an unsigned redirect the rules held", async () => {
    const panera = [
      "Thank you for contacting us.",
      "",
      "Requests must be submitted by completing our web form<https://www.acme.test/privacy-requests> or calling 1-888-555-0142.",
    ].join("\n");
    const result = await classify(
      { model: host(answer("auto_ack", 0.99)) },
      message({ text: panera, verifyDkim: noDkim }),
    );
    expect(result).toMatchObject({ classification: "needs_form", apply: false, source: "model" });
    expect(result.suggestion).toMatchObject({ classification: "auto_ack", confidence: 0.99 });
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

  it("suggests a confirmation link on the request's site without applying it", async () => {
    const result = await classify(
      { model: host(answer("confirmation_link", 0.99)) },
      message({ text: "Please follow https://acme.test/x/abc123 to proceed." }),
    );
    expect(result).toMatchObject({
      apply: false,
      source: "model",
      suggestion: { classification: "confirmation_link", source: "model" },
    });
  });

  it("suggests needs_form and verification_required without applying either", async () => {
    const form = await classify(
      { model: host(answer("needs_form", 0.99)) },
      message({ text: "Hmm. Our form is at https://acme.test/privacy-form if you want it." }),
    );
    expect(form).toMatchObject({
      apply: false,
      suggestion: { classification: "needs_form", source: "model" },
    });

    const verify = await classify(
      { model: host(answer("verification_required", 0.99)) },
      message({ text: "Hmm. Reply with your zip and your phone number." }),
    );
    expect(verify).toMatchObject({
      apply: false,
      suggestion: { classification: "verification_required", source: "model" },
    });
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

describe("mail that neither answers ours nor names the request", () => {
  const DONE = "Your data has been deleted.";
  const fromVendor = (text: string, overrides: Partial<InboxMessage> = {}) =>
    message({
      from: { name: "Support Desk", address: "desk@vendor.test" },
      inReplyTo: null,
      verifyDkim: noDkim,
      text,
      ...overrides,
    });
  const asked = (setup: Setup, mail: InboxMessage) =>
    classifierWith(setup).classify(mail, { requests: [request], senderTargetIds: ["acme"] });

  it("is never applied on the model's word, even once it names the target", async () => {
    const named = fromVendor(`${VAGUE}\n\nAcme Data Privacy Team`);
    for (const mail of [fromVendor(VAGUE), named]) {
      const result = await asked({ model: host(answer("auto_ack", 0.999)) }, mail);
      expect(result).toMatchObject({
        requestId: "req-1",
        apply: false,
        source: "model",
        suggestion: { classification: "auto_ack", source: "model" },
      });
    }
  });

  it("is never applied on the rules' word", async () => {
    const result = await asked({}, fromVendor(DONE));
    expect(result).toMatchObject({
      requestId: "req-1",
      classification: "completed",
      apply: false,
      confidence: 0.55,
    });
    expect(result.rationale).toContain("does not name this request");
  });

  it("is not applied from a sender the target does not sign for, even once the name is the target's", async () => {
    const named = fromVendor(DONE, { from: { name: "Acme Data", address: "desk@vendor.test" } });
    expect(await asked({}, named)).toMatchObject({ classification: "completed", apply: false });
  });

  it("is applied when it is threaded to our message and signed by the target", async () => {
    const threaded = fromVendor(DONE, {
      inReplyTo: request.outgoingMessageId,
      verifyDkim: signedAs("acme.test", { inReplyTo: [request.outgoingMessageId ?? ""] }),
    });
    expect(await asked({}, threaded)).toMatchObject({ classification: "completed", apply: true });
  });

  it("is applied when it comes from the target's own domain and the signature covers the reference", async () => {
    const own = fromVendor(`${DONE} Reference ${request.reference}.`, {
      from: { name: null, address: "desk@acme.test" },
      verifyDkim: signedAs("acme.test"),
    });
    expect(await asked({}, own)).toMatchObject({ classification: "completed", apply: true });
  });
});
