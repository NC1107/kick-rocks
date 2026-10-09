import type { ReplyModelCheck, ReplyModelView } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { bandText, precisionText, stateText, thresholdText } from "./reply-model.js";

const check = (overrides: Partial<ReplyModelCheck> = {}): ReplyModelCheck => ({
  spotChecks: 0,
  agreed: 0,
  precision: null,
  low: null,
  high: null,
  needed: 20,
  bands: [],
  ...overrides,
});

const view = (overrides: Partial<ReplyModelView> = {}): ReplyModelView => ({
  status: { state: "loaded", reason: null, version: "v1", threshold: 0.961 },
  threshold: 0.961,
  thresholdOverride: null,
  spotCheckPercent: 10,
  paused: null,
  check: check(),
  ...overrides,
});

describe("the reply model card", () => {
  it("says what state the model is in", () => {
    expect(stateText(view().status)).toBe("Loaded, version v1");
    expect(
      stateText({ state: "not_installed", reason: null, version: null, threshold: null }),
    ).toBe("Not installed");
    expect(
      stateText({
        state: "failed",
        reason: "model.onnx is missing",
        version: null,
        threshold: null,
      }),
    ).toBe("Failed: model.onnx is missing");
  });

  it("says where answers are applied, or that they are not", () => {
    expect(thresholdText(view())).toBe("96.1% or more");
    expect(thresholdText(view({ threshold: null }))).toBe("Not applying");
    expect(thresholdText(view({ paused: { at: "2026-10-01T00:00:00.000Z", reason: "x" } }))).toBe(
      "Paused",
    );
  });

  it("gives the spot check result with its interval only once there are enough", () => {
    expect(precisionText(check())).toBe("None answered yet");
    expect(precisionText(check({ spotChecks: 5, agreed: 5, precision: 1 }))).toBe(
      "5 of 5, 20 needed to judge",
    );
    expect(
      precisionText(check({ spotChecks: 20, agreed: 19, precision: 0.95, low: 0.76, high: 0.99 })),
    ).toBe("19 of 20 (95%), likely 76% to 99%");
  });

  it("lists agreement by band", () => {
    expect(bandText({ from: 0.5, to: 0.7, answers: 6, accepted: 4 })).toEqual({
      range: "50% to 70%",
      agreed: "4 of 6 agreed",
    });
    expect(bandText({ from: 0.9, to: 0.96, answers: 0, accepted: 0 }).agreed).toBe("none");
  });
});
