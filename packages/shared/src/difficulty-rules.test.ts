import { describe, expect, it } from "vitest";
import { classifyDifficulty, type DifficultyInput } from "./difficulty-rules.js";

const none = { scan: null, remove: null } as const;

function target(overrides: Partial<DifficultyInput> = {}): DifficultyInput {
  return {
    id: "acme",
    category: "marketing",
    privacyEmail: "privacy@acme.example",
    optOutUrl: null,
    requiresId: false,
    requirements: [],
    recipes: none,
    ...overrides,
  };
}

const peopleSearch = (overrides: Partial<DifficultyInput> = {}) =>
  target({ id: "finder", category: "people-search", privacyEmail: null, ...overrides });

describe("easy", () => {
  it("is a target that takes requests at a privacy address on its own domain", () => {
    expect(classifyDifficulty(target())).toEqual({
      difficulty: "easy",
      reasons: ["email", "no_record_needed"],
    });
  });

  it("allows an email confirmation link because Kick Rocks follows it", () => {
    expect(classifyDifficulty(target({ requirements: ["email_confirmation"] })).difficulty).toBe(
      "easy",
    );
  });

  it("does not need an approved recipe", () => {
    expect(classifyDifficulty(target({ recipes: none })).difficulty).toBe("easy");
  });

  it("stays easy when the address is also backed by a form", () => {
    expect(
      classifyDifficulty(target({ optOutUrl: "https://acme.example/optout" })).difficulty,
    ).toBe("easy");
  });

  it.each([
    ["phone_call", "needs_phone"],
    ["id_upload", "needs_id"],
    ["paid", "needs_payment"],
    ["account", "needs_account"],
    ["captcha", "captcha"],
    ["postal_mail", "needs_mail"],
    ["fax", "needs_fax"],
  ] as const)("is hard when the site needs the person for %s", (requirement, reason) => {
    expect(classifyDifficulty(target({ requirements: [requirement] }))).toEqual({
      difficulty: "hard",
      reasons: [reason],
    });
  });

  it("is hard when the site asks for ID through the flag or the category alone", () => {
    expect(classifyDifficulty(target({ requiresId: true }))).toEqual({
      difficulty: "hard",
      reasons: ["needs_id"],
    });
    expect(classifyDifficulty(target({ category: "requires-id" }))).toEqual({
      difficulty: "hard",
      reasons: ["needs_id"],
    });
  });

  it("lists each person-needed reason once, ID included", () => {
    const result = classifyDifficulty(
      target({ requirements: ["id_upload", "phone_call"], requiresId: true }),
    );
    expect(result.reasons).toEqual(["needs_phone", "needs_id"]);
  });

  it("is not easy when the record must be found first", () => {
    expect(classifyDifficulty(target({ requirements: ["record_url"] })).difficulty).toBe("hard");
    expect(classifyDifficulty(target({ category: "background-check" })).difficulty).toBe("hard");
  });

  it("is not easy when the only address is on a shared mail host", () => {
    expect(classifyDifficulty(target({ privacyEmail: "owner@gmail.com" }))).toEqual({
      difficulty: "hard",
      reasons: ["email_shared", "no_contact"],
    });
  });

  it("falls back to the form when the address is shared", () => {
    const result = classifyDifficulty(
      target({
        privacyEmail: "owner@Gmail.com",
        optOutUrl: "https://acme.example/optout",
        recipes: { scan: null, remove: "healthy" },
      }),
    );
    expect(result).toEqual({
      difficulty: "medium",
      reasons: ["email_shared", "form", "recipe_ready"],
    });
  });
});

describe("medium", () => {
  const form = { privacyEmail: null, optOutUrl: "https://acme.example/optout" } as const;

  it.each(["unknown", "healthy"] as const)(
    "is a web form with an approved remove recipe whose health is %s",
    (health) => {
      expect(
        classifyDifficulty(target({ ...form, recipes: { scan: null, remove: health } })),
      ).toEqual({ difficulty: "medium", reasons: ["form", "recipe_ready"] });
    },
  );

  it("is a people-search site with approved scan and remove recipes", () => {
    expect(
      classifyDifficulty(peopleSearch({ recipes: { scan: "healthy", remove: "unknown" } })),
    ).toEqual({ difficulty: "medium", reasons: ["needs_record", "recipe_ready"] });
  });

  it("ignores a scan recipe on a plain form target", () => {
    expect(
      classifyDifficulty(target({ ...form, recipes: { scan: "healthy", remove: null } }))
        .difficulty,
    ).toBe("hard");
  });

  it("is hard when a person must do part of it, recipe or not", () => {
    expect(
      classifyDifficulty(
        target({ ...form, requirements: ["captcha"], recipes: { scan: null, remove: "healthy" } }),
      ),
    ).toEqual({ difficulty: "hard", reasons: ["captcha"] });
    expect(
      classifyDifficulty(
        peopleSearch({
          requirements: ["phone_call"],
          recipes: { scan: "healthy", remove: "healthy" },
        }),
      ),
    ).toEqual({ difficulty: "hard", reasons: ["needs_record", "needs_phone"] });
  });
});

describe("hard", () => {
  const form = { privacyEmail: null, optOutUrl: "https://acme.example/optout" } as const;

  it("is a form with no approved recipe", () => {
    expect(classifyDifficulty(target(form))).toEqual({
      difficulty: "hard",
      reasons: ["form", "no_recipe"],
    });
  });

  it("is a form whose remove recipe is broken", () => {
    expect(
      classifyDifficulty(target({ ...form, recipes: { scan: null, remove: "broken" } })),
    ).toEqual({ difficulty: "hard", reasons: ["form", "recipe_broken"] });
  });

  it("is a target with no email and no opt-out page", () => {
    expect(classifyDifficulty(target({ privacyEmail: null }))).toEqual({
      difficulty: "hard",
      reasons: ["no_contact"],
    });
  });

  it("is a people-search site with no recipes, naming the missing automation", () => {
    expect(classifyDifficulty(peopleSearch())).toEqual({
      difficulty: "hard",
      reasons: ["needs_record", "no_recipe"],
    });
  });

  it("is a people-search site missing only its remove recipe", () => {
    expect(
      classifyDifficulty(peopleSearch({ recipes: { scan: "healthy", remove: null } })).reasons,
    ).toEqual(["needs_record", "no_recipe"]);
  });

  it("is a people-search site whose scan recipe is broken", () => {
    expect(
      classifyDifficulty(peopleSearch({ recipes: { scan: "broken", remove: "healthy" } })),
    ).toEqual({ difficulty: "hard", reasons: ["needs_record", "recipe_broken"] });
  });

  it("is a people-search site with an email address, because the listing still has to be found", () => {
    expect(classifyDifficulty(peopleSearch({ privacyEmail: "privacy@finder.example" }))).toEqual({
      difficulty: "hard",
      reasons: ["needs_record", "no_recipe"],
    });
  });
});
