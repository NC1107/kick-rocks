import type { ReplyModelView } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { bandText, stateText } from "./reply-model.js";

const view = (overrides: Partial<ReplyModelView> = {}): ReplyModelView => ({
  status: { state: "loaded", reason: null, version: "v1", threshold: 0.961 },
  bands: [],
  ...overrides,
});

describe("the reply model card", () => {
  it("says what state the model is in", () => {
    expect(stateText(view().status)).toBe("Loaded, version v1");
    expect(
      stateText({
        state: "loaded",
        reason: "Not enough free memory",
        version: "v1",
        threshold: 0.9,
      }),
    ).toBe("Loaded, version v1. Skipped the last reply: Not enough free memory");
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

  it("lists agreement by band", () => {
    expect(bandText({ from: 0.5, to: 0.7, answers: 6, accepted: 4 })).toEqual({
      range: "50% to 70%",
      agreed: "4 of 6 agreed",
    });
    expect(bandText({ from: 0.9, to: 0.96, answers: 0, accepted: 0 }).agreed).toBe("none");
  });
});
