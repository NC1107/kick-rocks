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

describe("a remove recipe that reaches the record the person confirmed", () => {
  const recordRemove = {
    id: "fastpeoplesearch.remove.v1",
    brokerId: "fastpeoplesearch",
    version: 1,
    purpose: "remove",
    entryUrl: "https://www.fastpeoplesearch.test/removal",
    fields: ["record_url", "first_name", "last_name", "state", "email"],
    steps: [
      { kind: "goto", url: "{{record_url}}" },
      { kind: "wait_for", target: { css: ".record" } },
      { kind: "click", target: { role: "link", label: "Remove my record" } },
      { kind: "expect_text", text: "will be removed" },
    ],
    canary: { url: "https://www.fastpeoplesearch.test/removal", selectors: [{ css: "form" }] },
  };

  const proof = { kind: "expect_text", text: "will be removed" };

  it("accepts a goto that is exactly {{record_url}}", () => {
    expect(failure(recordRemove)).toEqual([]);
    expect(
      failure({
        ...recordRemove,
        steps: [{ kind: "goto", url: "{{ record_url }}" }, recordRemove.steps[2], proof],
      }),
    ).toEqual([]);
  });

  it("still rejects any other bare template as a url", () => {
    for (const url of ["{{first_name}}", "{{email}}", "{{record_url|lower}}", "{{record_url}}/x"]) {
      expect(
        failure({ ...recordRemove, steps: [{ kind: "goto", url }, recordRemove.steps[2], proof] }),
        url,
      ).not.toEqual([]);
    }
  });

  it("keeps the host of a url literal, so no value can pick the site that gets the details", () => {
    for (const url of [
      "https://{{email}}/x",
      "https://www.{{first_name}}.test/",
      "http://x.test{{email}}",
    ]) {
      const problems = failure({
        ...recordRemove,
        steps: [{ kind: "goto", url }, recordRemove.steps[2], proof],
      });
      expect(problems.join(), url).toMatch(/host of a url must be written out|Uses field/);
    }
    expect(
      failure({
        ...recordRemove,
        steps: [
          { kind: "goto", url: "https://www.fastpeoplesearch.test/{{first_name|slug}}" },
          recordRemove.steps[2],
          proof,
        ],
      }),
    ).toEqual([]);
    expect(
      failure({
        ...recordRemove,
        steps: [
          { kind: "goto", url: "https://{{first_name}}.test/" },
          recordRemove.steps[2],
          proof,
        ],
      }),
    ).toEqual(["The host of a url must be written out, not filled from a template"]);
  });

  it("needs record_url declared like any other field", () => {
    expect(failure({ ...recordRemove, fields: ["email"] })).toEqual([
      'Uses field "record_url" that the recipe does not declare in fields',
    ]);
  });

  it("picks one result out of a list with select_record", () => {
    const select = {
      kind: "select_record",
      item: { css: ".result" },
      link: { css: "a.profile", attr: "href" },
      action: "click",
    };
    const steps = [
      { kind: "goto", url: "https://www.fastpeoplesearch.test/search?q={{first_name|slug}}" },
      select,
      proof,
    ];
    expect(failure({ ...recordRemove, steps })).toEqual([]);
    expect(failure({ ...recordRemove, fields: ["first_name"], steps })).toEqual([
      'Uses field "record_url" that the recipe does not declare in fields',
    ]);
    expect(RecipeStep.safeParse({ ...select, action: "hover" }).success).toBe(false);
  });

  it("defaults select_record to a list that is not exhaustive", () => {
    const parsed = RecipeStep.parse({
      kind: "select_record",
      item: { css: ".result" },
      link: { css: "a", attr: "href" },
      action: "click",
    });
    expect(parsed).toMatchObject({ exhaustive: false });
  });

  describe("proof that the site accepted the request", () => {
    const message = /needs an expect_text, expect_url, or outcome_when/;
    const click = recordRemove.steps[2];
    const withSteps = (steps: unknown[]) => failure({ ...recordRemove, steps });

    it("rejects a remove recipe that ends at its submit", () => {
      expect(withSteps([recordRemove.steps[0], click]).join()).toMatch(message);
    });

    it("rejects a proof that comes before the last submit", () => {
      expect(withSteps([recordRemove.steps[0], proof, click]).join()).toMatch(message);
    });

    it.each([
      ["expect_text", { kind: "expect_text", text: "done" }],
      ["expect_url", { kind: "expect_url", pattern: "/done$" }],
      [
        "a positive outcome_when",
        { kind: "outcome_when", when: [{ text: "done", outcome: "submitted" }] },
      ],
      [
        "a positive outcome_when for an email",
        { kind: "outcome_when", when: [{ text: "sent", outcome: "awaiting_email_confirmation" }] },
      ],
    ])("accepts %s after the submit", (_name, step) => {
      expect(withSteps([recordRemove.steps[0], click, step])).toEqual([]);
    });

    it("does not take an outcome_when that only blocks or reports a missing record as proof", () => {
      const onlyNegative = {
        kind: "outcome_when",
        when: [
          { text: "no record", outcome: "not_found" },
          { text: "phone", outcome: "blocked", reason: "phone_verification" },
        ],
      };
      expect(withSteps([recordRemove.steps[0], click, onlyNegative]).join()).toMatch(message);
    });

    it("does not ask a scan recipe for proof", () => {
      expect(failure(scanRecipe)).toEqual([]);
    });
  });

  it("keeps select_record and email_confirmation out of scan recipes", () => {
    const steps = [
      ...scanRecipe.steps,
      {
        kind: "select_record",
        item: { css: ".r" },
        link: { css: "a", attr: "href" },
        action: "click",
      },
    ];
    expect(failure({ ...scanRecipe, fields: [...scanRecipe.fields, "record_url"], steps })).toEqual(
      expect.arrayContaining([
        "Only a remove recipe may use select_record",
        "A scan finds the record, so it cannot start from record_url",
      ]),
    );
  });
});

describe("steps are strict", () => {
  it("rejects a key the step does not have, instead of dropping it", () => {
    expect(
      RecipeStep.safeParse({ kind: "click", target: { css: "a" }, optionl: true }).success,
    ).toBe(false);
    expect(
      RecipeStep.safeParse({ kind: "goto", url: "https://x.test", optional: true }).success,
    ).toBe(false);
    expect(RecipeStep.safeParse({ kind: "captcha_checkpoint", extra: 1 }).success).toBe(false);
  });

  it("rejects an unknown key on a selector, a candidate field, and the recipe itself", () => {
    expect(Selector.safeParse({ css: "a", nth: 2 }).success).toBe(false);
    expect(
      RecipeStep.safeParse({
        kind: "extract_candidates",
        item: { css: "li" },
        fields: { recordUrl: { css: "a", attr: "href", first: true }, name: { css: "b" } },
      }).success,
    ).toBe(false);
    expect(failure({ ...scanRecipe, verifiedat: "2026-10-01" })).not.toEqual([]);
  });

  it("keeps an author's optional flag instead of silently making the step mandatory", () => {
    expect(RecipeStep.parse({ kind: "click", target: { css: "a" }, optional: true })).toMatchObject(
      { optional: true },
    );
    expect(RecipeStep.parse({ kind: "click", target: { css: "a" } })).toMatchObject({
      optional: false,
    });
    for (const step of [
      { kind: "fill", target: { css: "i" }, field: "email" },
      { kind: "select", target: { css: "s" }, field: "state" },
      { kind: "check", target: { css: "c" } },
      { kind: "press", key: "Enter" },
      { kind: "wait_for", target: { css: "w" } },
    ]) {
      expect(RecipeStep.parse({ ...step, optional: true }), step.kind).toMatchObject({
        optional: true,
      });
    }
  });
});

describe("waiting, frames, and selecting options", () => {
  it("waits for an element to appear by default and can wait for it to go", () => {
    expect(RecipeStep.parse({ kind: "wait_for", target: { css: ".spinner" } })).toMatchObject({
      state: "visible",
    });
    for (const state of ["visible", "hidden", "attached", "detached"]) {
      expect(
        RecipeStep.safeParse({ kind: "wait_for", target: { css: ".x" }, state }).success,
        state,
      ).toBe(true);
    }
    expect(
      RecipeStep.safeParse({ kind: "wait_for", target: { css: ".x" }, state: "gone" }).success,
    ).toBe(false);
  });

  it("targets a form inside an iframe", () => {
    const step = RecipeStep.parse({
      kind: "fill",
      target: { label: "Email" },
      field: "email",
      frame: { css: "iframe#optout" },
    });
    expect(step).toMatchObject({ frame: { css: "iframe#optout" } });
  });

  it("selects by label unless told to use the value, from a field or a template", () => {
    const target = { css: "select" };
    expect(RecipeStep.parse({ kind: "select", target, field: "state" })).toMatchObject({
      by: "label",
    });
    expect(
      RecipeStep.parse({ kind: "select", target, value: "{{state|state_name}}", by: "label" }),
    ).toMatchObject({ value: "{{state|state_name}}" });
    expect(
      RecipeStep.safeParse({ kind: "select", target, value: "privacy", by: "value" }).success,
    ).toBe(true);
    expect(RecipeStep.safeParse({ kind: "select", target }).success).toBe(false);
    expect(
      RecipeStep.safeParse({ kind: "select", target, field: "state", value: "x" }).success,
    ).toBe(false);
    expect(
      RecipeStep.safeParse({ kind: "select", target, field: "state", by: "text" }).success,
    ).toBe(false);
  });

  it("reads emails off a result as well as phones and relatives", () => {
    expect(
      RecipeStep.safeParse({
        kind: "extract_candidates",
        item: { css: "li" },
        fields: {
          recordUrl: { css: "a", attr: "href" },
          name: { css: "b" },
          emails: { css: ".mail", all: true },
        },
      }).success,
    ).toBe(true);
  });

  it("rejects a template with a filter that does not exist or a malformed placeholder", () => {
    const withUrl = (url: string) => ({
      ...scanRecipe,
      steps: [{ kind: "goto", url }, scanRecipe.steps[2]],
    });
    expect(failure(withUrl("https://x.test/{{first_name|shout}}"))).toEqual(
      expect.arrayContaining(['Unknown template filter "shout"']),
    );
    expect(failure(withUrl("https://x.test/{{first_name"))).not.toEqual([]);
  });
});

describe("ending a run with an outcome", () => {
  const whenStep = (when: unknown[]) => ({ kind: "outcome_when", when });

  it("maps what is on the page to a form outcome or a human check", () => {
    const step = RecipeStep.parse(
      whenStep([
        { text: "No records found", outcome: "not_found" },
        { selector: { css: ".already-removed" }, outcome: "already_removed" },
        { urlPattern: "/verify-phone", outcome: "blocked", reason: "phone_verification" },
      ]),
    );
    expect(step.kind).toBe("outcome_when");
  });

  it("needs a reason for a blocked outcome and none for the others", () => {
    expect(RecipeStep.safeParse(whenStep([{ text: "x", outcome: "blocked" }])).success).toBe(false);
    expect(
      RecipeStep.safeParse(whenStep([{ text: "x", outcome: "not_found", reason: "captcha" }]))
        .success,
    ).toBe(false);
  });

  it("needs something to look for and at least one condition", () => {
    expect(RecipeStep.safeParse(whenStep([{ outcome: "not_found" }])).success).toBe(false);
    expect(RecipeStep.safeParse(whenStep([])).success).toBe(false);
    expect(RecipeStep.safeParse(whenStep([{ text: "x", outcome: "done" }])).success).toBe(false);
  });

  it("lets a scan end a run only as blocked", () => {
    const blocked = whenStep([{ text: "Are you human", outcome: "blocked", reason: "captcha" }]);
    const notFound = whenStep([{ text: "none", outcome: "not_found" }]);
    expect(
      failure({ ...scanRecipe, steps: [scanRecipe.steps[0], blocked, scanRecipe.steps[2]] }),
    ).toEqual([]);
    expect(
      failure({ ...scanRecipe, steps: [scanRecipe.steps[0], notFound, scanRecipe.steps[2]] }),
    ).toEqual(["A scan can only end a run as blocked"]);
  });
});

describe("one recipe for several brokers", () => {
  it("defaults to none and may not list its own broker", () => {
    expect(Recipe.parse(scanRecipe).alsoFor).toEqual([]);
    expect(
      Recipe.parse({ ...scanRecipe, alsoFor: ["peoplelooker", "instantcheckmate"] }).alsoFor,
    ).toEqual(["peoplelooker", "instantcheckmate"]);
    expect(failure({ ...scanRecipe, alsoFor: ["spokeo"] })).toEqual([
      "alsoFor lists other brokers, not the recipe's own",
    ]);
  });
});

describe("canary steps", () => {
  const withCanarySteps = (steps: unknown[]) => ({
    ...scanRecipe,
    canary: { url: "https://www.spokeo.test/search", selectors: [{ css: ".results" }], steps },
  });

  it("defaults to none", () => {
    expect(Recipe.parse(scanRecipe).canary.steps).toEqual([]);
  });

  it("lets a scan canary search for a generic name and wait for results", () => {
    expect(
      failure(
        withCanarySteps([
          { kind: "goto", url: "https://www.spokeo.test/search" },
          { kind: "fill", target: { label: "Name" }, value: "John Smith" },
          { kind: "click", target: { role: "button", label: "Search" } },
          { kind: "wait_for", target: { css: ".results" } },
        ]),
      ),
    ).toEqual([]);
  });

  it("never types a profile field or a template, so a health check discloses nobody", () => {
    expect(
      failure(withCanarySteps([{ kind: "fill", target: { label: "Name" }, field: "full_name" }])),
    ).not.toEqual([]);
    expect(
      failure(
        withCanarySteps([{ kind: "fill", target: { label: "Name" }, value: "{{full_name}}" }]),
      ),
    ).not.toEqual([]);
  });

  it("allows only goto, fill, click, and wait_for", () => {
    expect(failure(withCanarySteps([{ kind: "captcha_checkpoint" }]))).not.toEqual([]);
    expect(failure(withCanarySteps([{ kind: "goto", url: "{{record_url}}" }]))).not.toEqual([]);
    expect(
      failure(
        withCanarySteps(
          Array.from({ length: 11 }, () => ({ kind: "click", target: { css: "a" } })),
        ),
      ),
    ).not.toEqual([]);
  });

  it("is not allowed on a remove recipe, where a click could submit a removal", () => {
    expect(
      failure({
        ...removeRecipe,
        canary: {
          url: "https://www.spokeo.test/optout",
          selectors: [{ label: "Email" }],
          steps: [{ kind: "click", target: { css: "button" } }],
        },
      }),
    ).toEqual(["Only a scan recipe may have canary steps, because a click there is a search"]);
  });
});
