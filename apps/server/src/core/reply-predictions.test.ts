import { replyPredictions } from "@kickrocks/db";
import { API_ROUTES, type ReplyClassification } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { inputSha256 } from "../mail/reply-model/input.js";
import type { ClassificationResult } from "../mail/types.js";
import {
  createTestContext,
  seedMailbox,
  seedMessage,
  seedProfile,
  seedRequest,
  seedTarget,
  type TestContext,
} from "../test-utils/index.js";

let ctx: TestContext;
let profileId: string;
let mailboxId: string;

beforeEach(async () => {
  ctx = await createTestContext();
  profileId = seedProfile(ctx).id;
  mailboxId = seedMailbox(ctx, profileId).id;
});

afterEach(async () => {
  await ctx.close();
});

function result(overrides: Partial<ClassificationResult> = {}): ClassificationResult {
  return {
    requestId: null,
    correlation: null,
    classification: "unknown",
    confidence: 0.2,
    rationale: "",
    links: [],
    requestedFields: [],
    source: "rules",
    apply: false,
    suggestion: null,
    prediction: { rules: { label: "unknown", confidence: 0.2 }, model: null, inputSha256: null },
    ...overrides,
  };
}

function modelAnswer(
  label: ReplyClassification,
  confidence: number,
  spotCheck = false,
): Partial<ClassificationResult> {
  return {
    source: "model",
    suggestion: { classification: label, confidence, source: "model", spotCheck },
    prediction: {
      rules: { label: "unknown", confidence: 0.2 },
      model: {
        version: "v1",
        label,
        confidence,
        probabilities: { [label]: confidence } as Record<ReplyClassification, number>,
      },
      inputSha256: "a".repeat(64),
    },
  };
}

function message(extra: Partial<Parameters<typeof seedMessage>[1]> = {}) {
  return seedMessage(ctx, { mailboxId, ...extra });
}

const rows = () => ctx.services.db.select().from(replyPredictions).all();
const row = (id: string) =>
  ctx.services.db.select().from(replyPredictions).where(eq(replyPredictions.messageId, id)).get();

async function decide(id: string, classification: ReplyClassification) {
  return ctx.call(API_ROUTES.messageClassify, { params: { id }, body: { classification } });
}

describe("recording what the machine said", () => {
  it("keeps the model's guess apart from the person's answer", async () => {
    const sent = message();
    ctx.services.replyPredictions.record(sent.id, result(modelAnswer("no_record", 0.88)));
    expect(row(sent.id)).toMatchObject({
      source: "model",
      modelVersion: "v1",
      modelLabel: "no_record",
      modelConfidence: 0.88,
      rulesLabel: "unknown",
      autoApplied: false,
      spotCheck: false,
      personLabel: null,
      acceptedSuggestion: null,
    });

    await decide(sent.id, "completed");
    expect(row(sent.id)).toMatchObject({ personLabel: "completed", acceptedSuggestion: false });
    expect(row(sent.id)?.decidedAt).not.toBeNull();
  });

  it("notes when the person agreed", async () => {
    const sent = message();
    ctx.services.replyPredictions.record(sent.id, result(modelAnswer("no_record", 0.88)));
    await decide(sent.id, "no_record");
    expect(row(sent.id)?.acceptedSuggestion).toBe(true);
  });

  it("counts a correction of an answer that was applied by itself", async () => {
    const target = seedTarget(ctx, { domain: "acme.test" });
    const request = seedRequest(ctx, { profileId, targetId: target.id, status: "awaiting_reply" });
    const sent = message({ requestId: request.id, classification: "completed", confidence: 0.97 });
    ctx.services.replyPredictions.record(
      sent.id,
      result({ ...modelAnswer("completed", 0.97), suggestion: null, apply: true }),
    );
    await decide(sent.id, "rejected");
    expect(row(sent.id)).toMatchObject({
      autoApplied: true,
      modelLabel: "completed",
      personLabel: "rejected",
      acceptedSuggestion: false,
    });
  });

  it("compares a rules answer with the person's when no model had a say", async () => {
    const sent = message();
    ctx.services.replyPredictions.record(
      sent.id,
      result({
        prediction: {
          rules: { label: "auto_ack", confidence: 0.9 },
          model: null,
          inputSha256: null,
        },
        apply: true,
      }),
    );
    await decide(sent.id, "auto_ack");
    expect(row(sent.id)).toMatchObject({
      source: "rules",
      modelLabel: null,
      acceptedSuggestion: true,
    });
  });

  it("stores no text of the mail", () => {
    const sent = message({ text: "my secret reply text" });
    ctx.services.replyPredictions.record(sent.id, result(modelAnswer("no_record", 0.88)));
    expect(JSON.stringify(row(sent.id))).not.toContain("secret");
  });

  it("goes away with the message", () => {
    const sent = message();
    ctx.services.replyPredictions.record(sent.id, result(modelAnswer("no_record", 0.88)));
    ctx.services.db.$client.prepare("delete from messages where id = ?").run(sent.id);
    expect(rows()).toHaveLength(0);
  });

  it("ignores a decision about a message from before predictions were kept", async () => {
    const sent = message();
    const done = await decide(sent.id, "completed");
    expect(done.ok).toBe(true);
    expect(rows()).toHaveLength(0);
  });
});

describe("spot checks", () => {
  async function spot(label: ReplyClassification, person: ReplyClassification) {
    const sent = message();
    ctx.services.replyPredictions.record(sent.id, result(modelAnswer(label, 0.99, true)));
    await decide(sent.id, person);
  }

  it("give a precision with its interval", async () => {
    for (let i = 0; i < 9; i += 1) await spot("completed", "completed");
    await spot("completed", "rejected");
    const check = ctx.services.replyPredictions.check();
    expect(check).toMatchObject({ spotChecks: 10, agreed: 9, precision: 0.9, needed: 20 });
    expect(check.low).toBeGreaterThan(0.5);
    expect(check.high).toBeLessThan(1);
  });

  it("leave applying alone below twenty, whatever they say", async () => {
    for (let i = 0; i < 10; i += 1) await spot("completed", "rejected");
    expect(ctx.services.settings.get("replyModel.state").pausedAt).toBeNull();
  });

  it("stop model answers from being applied once twenty rule out 95%", async () => {
    for (let i = 0; i < 17; i += 1) await spot("completed", "completed");
    for (let i = 0; i < 3; i += 1) await spot("completed", "rejected");
    const state = ctx.services.settings.get("replyModel.state");
    expect(state.pausedAt).not.toBeNull();
    expect(state.reason).toMatch(/17 times out of 20/);
    const view = ctx.services.replyPredictions.view(ctx.services.replyModel.status());
    expect(view.paused?.reason).toBe(state.reason);
  });

  it("keep applying when twenty spot checks all agree", async () => {
    for (let i = 0; i < 20; i += 1) await spot("completed", "completed");
    expect(ctx.services.settings.get("replyModel.state").pausedAt).toBeNull();
    expect(ctx.services.replyPredictions.check().low).toBeGreaterThan(0.8);
  });

  it("start counting again from the moment a person resumes", async () => {
    for (let i = 0; i < 20; i += 1) await spot("completed", "rejected");
    expect(ctx.services.settings.get("replyModel.state").pausedAt).not.toBeNull();
    ctx.clock.advance(1000);
    await ctx.call(API_ROUTES.settingsPatch, { body: { replyModel: { resume: true } } });
    expect(ctx.services.settings.get("replyModel.state").pausedAt).toBeNull();
    expect(ctx.services.replyPredictions.check().spotChecks).toBe(0);
  });

  it("never lower the threshold by themselves", async () => {
    for (let i = 0; i < 20; i += 1) await spot("completed", "rejected");
    expect(ctx.services.settings.get("replyModel").threshold).toBeNull();
  });

  it("report agreement by the confidence of the answer", async () => {
    const low = message();
    ctx.services.replyPredictions.record(low.id, result(modelAnswer("no_record", 0.6)));
    await decide(low.id, "no_record");
    const high = message();
    ctx.services.replyPredictions.record(high.id, result(modelAnswer("no_record", 0.99, true)));
    await decide(high.id, "completed");
    const bands = ctx.services.replyPredictions.check().bands;
    expect(bands.find((band) => band.from === 0.5)).toMatchObject({ answers: 1, accepted: 1 });
    expect(bands.find((band) => band.from === 0.96)).toMatchObject({ answers: 1, accepted: 0 });
  });
});

describe("what Review starts from", () => {
  const queue = async () =>
    (await ctx.call(API_ROUTES.reviewQueue, { query: { profileId } })).body.messages;

  it("is the model's guess, with its confidence", async () => {
    const sent = message();
    ctx.services.replyPredictions.record(sent.id, result(modelAnswer("no_record", 0.87)));
    const [listed] = await queue();
    expect(listed?.suggestion).toEqual({
      classification: "no_record",
      confidence: 0.87,
      source: "model",
      spotCheck: false,
    });
  });

  it("is the rules' guess when the model had none and the rules said something", async () => {
    const sent = message({ classification: "rejected", confidence: 0.5 });
    ctx.services.replyPredictions.record(
      sent.id,
      result({
        classification: "rejected",
        confidence: 0.5,
        prediction: {
          rules: { label: "rejected", confidence: 0.5 },
          model: null,
          inputSha256: null,
        },
      }),
    );
    expect((await queue())[0]?.suggestion).toMatchObject({
      classification: "rejected",
      source: "rules",
    });
  });

  it("is nothing when the rules said unknown", async () => {
    const sent = message();
    ctx.services.replyPredictions.record(sent.id, result());
    expect((await queue())[0]?.suggestion).toBeNull();
  });

  it("is flagged for a spot check, so the page can leave it unanswered", async () => {
    const sent = message();
    ctx.services.replyPredictions.record(sent.id, result(modelAnswer("no_record", 0.99, true)));
    expect((await queue())[0]?.suggestion).toMatchObject({ spotCheck: true });
  });

  it("is nothing for mail from before predictions were kept", async () => {
    message();
    expect((await queue())[0]?.suggestion).toBeNull();
  });

  it("carries the language model's guess as its own", async () => {
    const sent = message();
    ctx.services.replyPredictions.record(
      sent.id,
      result({
        source: "llm",
        suggestion: {
          classification: "rejected",
          confidence: 0.7,
          source: "llm",
          spotCheck: false,
        },
      }),
    );
    expect((await queue())[0]?.suggestion).toMatchObject({
      classification: "rejected",
      source: "llm",
    });
  });
});

describe("the export of labelled replies", () => {
  async function download() {
    const response = await ctx.inject({ method: "GET", url: "/api/reply-model/labels" });
    return response;
  }

  it("holds the text the model read and the person's label, only on request", async () => {
    const body = "Hmm, interesting. Let me think about it.";
    const sent = message({ subject: "Re: Hello", text: body });
    const input = { subject: "Re: Hello", body };
    ctx.services.replyPredictions.record(
      sent.id,
      result({
        ...modelAnswer("no_record", 0.88),
        prediction: {
          ...(modelAnswer("no_record", 0.88).prediction as never),
          inputSha256: inputSha256(input),
        },
      }),
    );
    await decide(sent.id, "no_record");
    const response = await download();
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("application/x-ndjson");
    const [line] = response.body.trim().split("\n");
    expect(JSON.parse(line as string)).toMatchObject({
      text: `Subject: Re: Hello\n\n${body}`,
      label: "no_record",
      source: "model",
      modelLabel: "no_record",
    });
  });

  it("skips a reply whose text no longer matches its digest", async () => {
    const sent = message({ subject: "Re: Hello", text: "changed since" });
    ctx.services.replyPredictions.record(sent.id, result(modelAnswer("no_record", 0.88)));
    await decide(sent.id, "no_record");
    expect((await download()).body).toBe("");
  });

  it("leaves out replies nobody answered", async () => {
    const sent = message({ subject: "Re: Hello", text: "x" });
    ctx.services.replyPredictions.record(sent.id, result(modelAnswer("no_record", 0.88)));
    expect((await download()).body).toBe("");
  });
});

describe("the settings", () => {
  it("shows the reply model's state and defaults", async () => {
    const view = (await ctx.call(API_ROUTES.settingsGet)).body.replyModel;
    expect(view).toMatchObject({
      status: { state: "not_installed", reason: null, version: null },
      threshold: null,
      thresholdOverride: null,
      spotCheckPercent: 10,
      paused: null,
    });
  });

  it("saves the spot check share and a raised threshold, and refuses one under the floor", async () => {
    const saved = await ctx.call(API_ROUTES.settingsPatch, {
      body: { replyModel: { spotCheckPercent: 0, threshold: 0.98 } },
    });
    expect(saved.ok && saved.body.replyModel).toMatchObject({
      spotCheckPercent: 0,
      thresholdOverride: 0.98,
    });
    const refused = await ctx.call(API_ROUTES.settingsPatch, {
      body: { replyModel: { threshold: 0.8 } },
    });
    expect(refused.ok).toBe(false);
  });

  it("clears the raised threshold", async () => {
    await ctx.call(API_ROUTES.settingsPatch, { body: { replyModel: { threshold: 0.98 } } });
    await ctx.call(API_ROUTES.settingsPatch, { body: { replyModel: { threshold: null } } });
    expect(ctx.services.settings.get("replyModel").threshold).toBeNull();
  });
});
