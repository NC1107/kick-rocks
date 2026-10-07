import { describe, expect, it } from "vitest";
import { Recipe, RecipeStep, recipeId, Selector } from "./recipe.js";

const scanRecipe = {
  id: "spokeo.scan.v1",
  brokerId: "spokeo",
  version: 1,
  purpose: "scan",
  entryUrl: "https://www.spokeo.test/search",
  fields: ["first_name", "last_name", "city", "state"],
  steps: [
    {
      kind: "goto",
      url: "https://www.spokeo.test/{{first_name|slug}}-{{last_name|slug}}/{{state|lower}}",
    },
    { kind: "wait_for", target: { css: ".results" }, timeoutMs: 10000 },
    {
      kind: "extract_candidates",
      item: { css: ".result-card" },
      fields: {
        recordUrl: { css: "a.profile", attr: "href" },
        name: { css: "h2" },
        age: { css: ".age" },
        locations: { css: ".location", all: true },
      },
    },
  ],
  canary: { url: "https://www.spokeo.test/search", selectors: [{ css: "form.search" }] },
};

const removeRecipe = {
  id: "spokeo.remove.v2",
  brokerId: "spokeo",
  version: 2,
  purpose: "remove",
  entryUrl: "https://www.spokeo.test/optout",
  fields: ["record_url", "email", "full_name"],
  steps: [
    { kind: "goto", url: "https://www.spokeo.test/optout" },
    { kind: "fill", target: { label: "Profile URL" }, field: "record_url" },
    { kind: "fill", target: { label: "Email" }, field: "email" },
    { kind: "fill", target: { label: "Name" }, value: "{{full_name}}" },
    { kind: "check", target: { label: "I agree" } },
    { kind: "pause", minMs: 300, maxMs: 900 },
    { kind: "captcha_checkpoint" },
    { kind: "press", key: "Enter" },
    { kind: "expect_url", pattern: "optout/(sent|done)" },
    { kind: "expect_text", text: "check your email" },
    { kind: "extract_text", target: { css: ".confirmation" }, as: "confirmation_text" },
    { kind: "email_confirmation", fromDomain: "spokeo.test" },
  ],
  canary: { url: "https://www.spokeo.test/optout", selectors: [{ label: "Email" }] },
  notes: "Verified read only.",
  verifiedAt: "2026-10-01",
  liveStatus: "blocked_by_bot_protection",
};

function failure(recipe: unknown) {
  const result = Recipe.safeParse(recipe);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe("Recipe", () => {
  it("accepts a scan recipe and applies metadata defaults", () => {
    const parsed = Recipe.parse(scanRecipe);
    expect(parsed).toMatchObject({ notes: null, verifiedAt: null, liveStatus: "unverified" });
  });

  it("accepts a remove recipe with every new step kind and keeps its metadata", () => {
    const parsed = Recipe.parse(removeRecipe);
    expect(parsed.verifiedAt).toBe("2026-10-01");
    expect(parsed.liveStatus).toBe("blocked_by_bot_protection");
    expect(parsed.steps.find((s) => s.kind === "check")).toMatchObject({ checked: true });
  });

  it("builds ids the same way the schema checks them", () => {
    expect(recipeId("spokeo", "scan", 1)).toBe("spokeo.scan.v1");
    expect(failure({ ...scanRecipe, id: "spokeo.scan.v2" })).toEqual(['Must be "spokeo.scan.v1"']);
    expect(failure({ ...removeRecipe, id: "other.remove.v2" })).toHaveLength(1);
  });

  it("rejects a step that uses a field the recipe does not declare", () => {
    const recipe = { ...removeRecipe, fields: ["record_url", "email"] };
    expect(failure(recipe)).toEqual([
      'Uses field "full_name" that the recipe does not declare in fields',
    ]);
    const goto = { ...scanRecipe, fields: ["first_name", "last_name", "city"] };
    expect(failure(goto)).toEqual([
      'Uses field "state" that the recipe does not declare in fields',
    ]);
  });

  it("rejects urls that are not http or https", () => {
    expect(failure({ ...scanRecipe, entryUrl: "javascript:alert(1)" })).not.toEqual([]);
    expect(failure({ ...scanRecipe, entryUrl: "file:///etc/passwd" })).not.toEqual([]);
    expect(
      failure({ ...scanRecipe, canary: { url: "ftp://x.test", selectors: [{ css: "a" }] } }),
    ).not.toEqual([]);
    expect(
      failure({
        ...scanRecipe,
        steps: [{ kind: "goto", url: "javascript:void(0)" }, scanRecipe.steps[2]],
      }),
    ).not.toEqual([]);
    expect(
      failure({
        ...scanRecipe,
        steps: [{ kind: "goto", url: "{{first_name}}" }, scanRecipe.steps[2]],
      }),
    ).not.toEqual([]);
  });

  it("needs an extract_candidates step to scan and forbids one elsewhere", () => {
    expect(failure({ ...scanRecipe, steps: [scanRecipe.steps[0]] })).toEqual([
      "A scan recipe needs an extract_candidates step",
    ]);
    expect(
      failure({ ...removeRecipe, steps: [...removeRecipe.steps, scanRecipe.steps[2]] }),
    ).toContain("Only a scan recipe may extract candidates");
  });

  it("needs steps and a canary selector", () => {
    expect(failure({ ...scanRecipe, steps: [] })).not.toEqual([]);
    expect(
      failure({ ...scanRecipe, canary: { url: "https://x.test", selectors: [] } }),
    ).not.toEqual([]);
  });

  it("rejects the old generic extract step", () => {
    expect(
      RecipeStep.safeParse({ kind: "extract", target: { css: "a" }, as: "candidates" }).success,
    ).toBe(false);
  });
});

describe("Selector", () => {
  it("needs at least one locator", () => {
    expect(Selector.safeParse({}).success).toBe(false);
    expect(Selector.safeParse({ role: "button", label: "Submit" }).success).toBe(true);
    expect(Selector.safeParse({ testId: "go" }).success).toBe(true);
  });
});

describe("RecipeStep", () => {
  it("requires exactly one of field or value on fill", () => {
    const target = { css: "input" };
    expect(RecipeStep.safeParse({ kind: "fill", target, field: "email" }).success).toBe(true);
    expect(RecipeStep.safeParse({ kind: "fill", target, value: "{{email}}" }).success).toBe(true);
    expect(RecipeStep.safeParse({ kind: "fill", target }).success).toBe(false);
    expect(RecipeStep.safeParse({ kind: "fill", target, field: "email", value: "x" }).success).toBe(
      false,
    );
  });

  it("orders pause bounds", () => {
    expect(RecipeStep.safeParse({ kind: "pause", minMs: 100, maxMs: 100 }).success).toBe(true);
    expect(RecipeStep.safeParse({ kind: "pause", minMs: 200, maxMs: 100 }).success).toBe(false);
    expect(RecipeStep.safeParse({ kind: "pause", minMs: -1, maxMs: 100 }).success).toBe(false);
  });

  it("validates the expect_url pattern as a regular expression", () => {
    expect(
      RecipeStep.safeParse({ kind: "expect_url", pattern: "^https://x\\.test/done" }).success,
    ).toBe(true);
    expect(RecipeStep.safeParse({ kind: "expect_url", pattern: "([" }).success).toBe(false);
  });

  it("lets a checkbox step uncheck", () => {
    expect(
      RecipeStep.parse({ kind: "check", target: { label: "Newsletter" }, checked: false }),
    ).toMatchObject({
      checked: false,
    });
  });

  it("keeps candidate fields optional except the url and name", () => {
    const minimal = {
      kind: "extract_candidates",
      item: { css: "li" },
      fields: { recordUrl: { css: "a", attr: "href" }, name: { css: "span" } },
    };
    expect(RecipeStep.safeParse(minimal).success).toBe(true);
    expect(RecipeStep.safeParse({ ...minimal, fields: { name: { css: "span" } } }).success).toBe(
      false,
    );
    expect(
      RecipeStep.safeParse({
        ...minimal,
        fields: {
          ...minimal.fields,
          relatives: { css: ".rel", all: true },
          phones: { css: ".tel", all: true },
        },
      }).success,
    ).toBe(true);
  });

  it("limits extract_text to confirmation text and record urls", () => {
    expect(
      RecipeStep.safeParse({ kind: "extract_text", target: { css: "p" }, as: "record_url" })
        .success,
    ).toBe(true);
    expect(
      RecipeStep.safeParse({ kind: "extract_text", target: { css: "p" }, as: "candidates" })
        .success,
    ).toBe(false);
  });
});
