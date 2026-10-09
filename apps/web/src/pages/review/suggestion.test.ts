import { describe, expect, it } from "vitest";
import { preselectOf, suggestionLine } from "./MailDetail.js";

const model = {
  classification: "completed",
  confidence: 0.874,
  source: "model",
  spotCheck: false,
} as const;

describe("what the select starts on", () => {
  it("is the guess of the model or the rules", () => {
    expect(preselectOf(model)).toBe("completed");
    expect(preselectOf({ ...model, source: "rules" })).toBe("completed");
    expect(preselectOf({ ...model, source: "llm" })).toBe("completed");
  });

  it("is nothing for a spot check, a guess of unknown, or no guess", () => {
    expect(preselectOf({ ...model, spotCheck: true })).toBe("");
    expect(preselectOf({ ...model, classification: "unknown" })).toBe("");
    expect(preselectOf(null)).toBe("");
  });
});

describe("the line above the select", () => {
  it("names the reply model and how sure it was", () => {
    expect(suggestionLine(model)).toBe("Suggested by the reply model, 87% sure");
  });

  it("names the rules without a number", () => {
    expect(suggestionLine({ ...model, source: "rules" })).toBe("Suggested by the rules");
  });

  it("names the language model", () => {
    expect(suggestionLine({ ...model, source: "llm", confidence: 0.7 })).toBe(
      "Suggested by the language model, 70% sure",
    );
  });

  it("says nothing when nothing starts selected", () => {
    expect(suggestionLine({ ...model, spotCheck: true })).toBeNull();
    expect(suggestionLine(null)).toBeNull();
  });
});
