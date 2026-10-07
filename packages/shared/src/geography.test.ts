import { describe, expect, it } from "vitest";
import { StateCode, stateName, US_STATES } from "./geography.js";

describe("US_STATES", () => {
  it("lists the 50 states and DC exactly once", () => {
    expect(US_STATES).toHaveLength(51);
    expect(new Set(US_STATES.map((s) => s.code)).size).toBe(51);
    expect(new Set(US_STATES.map((s) => s.name)).size).toBe(51);
  });

  it("keeps the code list and the schema in step", () => {
    expect(US_STATES.map((s) => s.code)).toEqual(StateCode.options);
  });

  it("names every state", () => {
    expect(stateName("TX")).toBe("Texas");
    expect(stateName("DC")).toBe("District of Columbia");
    for (const state of US_STATES) expect(state.name.length).toBeGreaterThan(2);
  });
});

describe("StateCode", () => {
  it("accepts postal codes only", () => {
    expect(StateCode.safeParse("CA").success).toBe(true);
    expect(StateCode.safeParse("ca").success).toBe(false);
    expect(StateCode.safeParse("XX").success).toBe(false);
    expect(StateCode.safeParse("California").success).toBe(false);
  });
});
