import { RecipeStep } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  checkLlm,
  checkPassword,
  checkSchedule,
  describeStep,
  draftOf,
  mcpClientConfig,
  workerState,
} from "./model.js";

const saved = {
  pollMinutes: 15,
  peopleSearchRescanDays: 60,
  brokerRescanDays: 90,
  noResponseDays: 45,
  maxFollowUps: 2,
};

describe("checkSchedule", () => {
  it("sends only what changed", () => {
    const draft = { ...draftOf(saved), pollMinutes: "30" };
    expect(checkSchedule(draft, saved)).toEqual({ errors: {}, patch: { pollMinutes: 30 } });
  });

  it("rejects a value outside its range or that is not a whole number", () => {
    const { errors, patch } = checkSchedule(
      { ...draftOf(saved), pollMinutes: "0", noResponseDays: "1.5", maxFollowUps: "" },
      saved,
    );
    expect(errors.pollMinutes).toBe("Enter 1 to 1440.");
    expect(errors.noResponseDays).toBe("Enter a whole number.");
    expect(errors.maxFollowUps).toBe("Enter a whole number.");
    expect(patch).toEqual({});
  });

  it("allows zero follow-ups, which turns them off", () => {
    const { errors, patch } = checkSchedule({ ...draftOf(saved), maxFollowUps: "0" }, saved);
    expect(errors).toEqual({});
    expect(patch).toEqual({ maxFollowUps: 0 });
  });
});

describe("checkLlm", () => {
  it("needs a web address and a model", () => {
    expect(checkLlm({ baseUrl: "ftp://x", model: "", apiKey: "" })).toEqual({
      baseUrl: "Enter a web address that starts with http:// or https://.",
      model: "Enter the model name.",
    });
    expect(
      checkLlm({ baseUrl: "http://localhost:11434/v1", model: "llama3.1", apiKey: "" }),
    ).toEqual({});
  });

  it("refuses a javascript address", () => {
    expect(
      checkLlm({ baseUrl: "javascript:alert(1)", model: "m", apiKey: "" }).baseUrl,
    ).toBeDefined();
  });
});

describe("checkPassword", () => {
  it("wants twelve characters and a matching repeat", () => {
    const errors = checkPassword({
      currentPassword: "old",
      newPassword: "short",
      confirm: "other",
    });
    expect(errors.newPassword).toContain("12");
    expect(errors.confirm).toBeDefined();
  });

  it("rejects reusing the current password", () => {
    const same = "a-long-enough-password";
    expect(
      checkPassword({ currentPassword: same, newPassword: same, confirm: same }).newPassword,
    ).toBeDefined();
  });

  it("accepts a good change", () => {
    expect(
      checkPassword({
        currentPassword: "old",
        newPassword: "a-long-enough-password",
        confirm: "a-long-enough-password",
      }),
    ).toEqual({});
  });
});

describe("workerState", () => {
  const now = Date.parse("2026-10-07T12:00:00Z");
  it("is online within two minutes of the last check-in", () => {
    expect(workerState("2026-10-07T11:59:00Z", now)).toBe("online");
    expect(workerState("2026-10-07T11:50:00Z", now)).toBe("offline");
    expect(workerState(null, now)).toBe("never");
  });
});

describe("mcpClientConfig", () => {
  it("holds a placeholder until a token has just been made", () => {
    const url = "http://localhost:8420/mcp";
    expect(JSON.parse(mcpClientConfig(url, null))).toEqual({
      mcpServers: {
        kickrocks: { type: "http", url, headers: { Authorization: "Bearer <your-token>" } },
      },
    });
    expect(mcpClientConfig(url, "krmcp_abc")).toContain("Bearer krmcp_abc");
  });
});

describe("describeStep", () => {
  it("gives every step kind a sentence", () => {
    const steps = RecipeStep.options.map((option) => option.shape.kind.value);
    expect(steps.length).toBeGreaterThan(10);
    const goto = RecipeStep.parse({ kind: "goto", url: "https://www.example.org/x" });
    expect(describeStep(goto)).toBe("Go to https://www.example.org/x");
    const click = RecipeStep.parse({ kind: "click", target: { role: "button", label: "Submit" } });
    expect(describeStep(click)).toBe("Click Submit");
  });
});
