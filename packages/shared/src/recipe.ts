import { z } from "zod";
import { ProfileField } from "./identities.js";
import { templateFields } from "./template.js";

export const RecipePurpose = z.enum(["scan", "remove"]);
export type RecipePurpose = z.infer<typeof RecipePurpose>;

export const RecipeSource = z.enum(["bundled", "proposed", "user"]);
export type RecipeSource = z.infer<typeof RecipeSource>;

export const RecipeStatus = z.enum(["active", "pending_review", "rejected", "retired"]);
export type RecipeStatus = z.infer<typeof RecipeStatus>;

export const RecipeHealth = z.enum(["unknown", "healthy", "broken"]);
export type RecipeHealth = z.infer<typeof RecipeHealth>;

/** How far a recipe has been checked against the live site by its author. */
export const RecipeLiveStatus = z.enum(["verified", "blocked_by_bot_protection", "unverified"]);
export type RecipeLiveStatus = z.infer<typeof RecipeLiveStatus>;

/** Scripts only ever navigate to web pages; a recipe is data and must not smuggle in other schemes. */
const HttpUrl = z.url({ protocol: /^https?$/ });
const HttpUrlTemplate = z.string().regex(/^https?:\/\//, "Must start with http:// or https://");

/** Locators in order of preference: role and label, test id, CSS, then visible text. */
export const Selector = z
  .object({
    role: z.string().min(1).optional(),
    label: z.string().min(1).optional(),
    testId: z.string().min(1).optional(),
    css: z.string().min(1).optional(),
    text: z.string().min(1).optional(),
  })
  .refine((s) => Object.values(s).some((v) => v !== undefined), {
    message: "A selector needs at least one of role, label, testId, css, or text",
  });
export type Selector = z.infer<typeof Selector>;

/** Where to read one candidate field, relative to the candidate's container element. */
export const CandidateField = z.object({
  css: z.string().min(1),
  /** Read this attribute instead of the element's text. */
  attr: z.string().min(1).optional(),
  /** Collect every match into a list instead of the first. */
  all: z.boolean().optional(),
});
export type CandidateField = z.infer<typeof CandidateField>;

const Goto = z.object({ kind: z.literal("goto"), url: HttpUrlTemplate });
const Fill = z
  .object({
    kind: z.literal("fill"),
    target: Selector,
    field: ProfileField.optional(),
    /** A template such as "{{first_name}} {{last_name}}", used instead of a single field. */
    value: z.string().min(1).optional(),
  })
  .refine((s) => (s.field === undefined) !== (s.value === undefined), {
    message: "A fill step needs exactly one of field or value",
  });
const Select = z.object({ kind: z.literal("select"), target: Selector, field: ProfileField });
const Click = z.object({ kind: z.literal("click"), target: Selector });
const Check = z.object({
  kind: z.literal("check"),
  target: Selector,
  checked: z.boolean().default(true),
});
const Press = z.object({
  kind: z.literal("press"),
  key: z.string().min(1),
  target: Selector.optional(),
});
const Pause = z
  .object({
    kind: z.literal("pause"),
    minMs: z.number().int().nonnegative(),
    maxMs: z.number().int().nonnegative(),
  })
  .refine((s) => s.minMs <= s.maxMs, { message: "minMs must not exceed maxMs" });
const WaitFor = z.object({
  kind: z.literal("wait_for"),
  target: Selector,
  timeoutMs: z.number().int().positive().optional(),
});
const ExpectText = z.object({ kind: z.literal("expect_text"), text: z.string().min(1) });
const ExpectUrl = z.object({
  kind: z.literal("expect_url"),
  /** A regular expression tested against the page URL. */
  pattern: z.string().refine(
    (source) => {
      try {
        new RegExp(source);
        return true;
      } catch {
        return false;
      }
    },
    { message: "Must be a valid regular expression" },
  ),
});
const ExtractCandidates = z.object({
  kind: z.literal("extract_candidates"),
  item: Selector,
  fields: z.object({
    recordUrl: CandidateField,
    name: CandidateField,
    age: CandidateField.optional(),
    locations: CandidateField.optional(),
    relatives: CandidateField.optional(),
    phones: CandidateField.optional(),
  }),
});
const ExtractText = z.object({
  kind: z.literal("extract_text"),
  target: Selector,
  as: z.enum(["confirmation_text", "record_url"]),
});
const CaptchaCheckpoint = z.object({ kind: z.literal("captcha_checkpoint") });
const EmailConfirmation = z.object({
  kind: z.literal("email_confirmation"),
  fromDomain: z.string().min(1),
  linkTextPattern: z.string().optional(),
});

export const RecipeStep = z.discriminatedUnion("kind", [
  Goto,
  Fill,
  Select,
  Click,
  Check,
  Press,
  Pause,
  WaitFor,
  ExpectText,
  ExpectUrl,
  ExtractCandidates,
  ExtractText,
  CaptchaCheckpoint,
  EmailConfirmation,
]);
export type RecipeStep = z.infer<typeof RecipeStep>;

export function recipeId(brokerId: string, purpose: RecipePurpose, version: number): string {
  return `${brokerId}.${purpose}.v${version}`;
}

/** Profile fields a step reads, whether named directly or through a template. */
function fieldsUsedBy(step: RecipeStep): string[] {
  switch (step.kind) {
    case "goto":
      return templateFields(step.url);
    case "fill":
      return step.field ? [step.field] : templateFields(step.value ?? "");
    case "select":
      return [step.field];
    default:
      return [];
  }
}

export const Recipe = z
  .object({
    /** `<brokerId>.<purpose>.v<version>`, also the file name without its extension. */
    id: z.string().min(1),
    brokerId: z.string().min(1),
    version: z.number().int().positive(),
    purpose: RecipePurpose,
    entryUrl: HttpUrl,
    fields: z.array(ProfileField),
    steps: z.array(RecipeStep).min(1).max(100),
    canary: z.object({
      url: HttpUrl,
      selectors: z.array(Selector).min(1),
    }),
    notes: z.string().nullable().default(null),
    /** The day the author last checked this recipe against the live site. */
    verifiedAt: z.iso.date().nullable().default(null),
    liveStatus: RecipeLiveStatus.default("unverified"),
  })
  .superRefine((recipe, ctx) => {
    if (recipe.id !== recipeId(recipe.brokerId, recipe.purpose, recipe.version)) {
      ctx.addIssue({
        code: "custom",
        path: ["id"],
        message: `Must be "${recipeId(recipe.brokerId, recipe.purpose, recipe.version)}"`,
      });
    }
    const declared = new Set<string>(recipe.fields);
    recipe.steps.forEach((step, index) => {
      for (const field of fieldsUsedBy(step)) {
        if (!declared.has(field)) {
          ctx.addIssue({
            code: "custom",
            path: ["steps", index],
            message: `Uses field "${field}" that the recipe does not declare in fields`,
          });
        }
      }
    });
    const extracts = recipe.steps.some((s) => s.kind === "extract_candidates");
    if (recipe.purpose === "scan" && !extracts) {
      ctx.addIssue({
        code: "custom",
        path: ["steps"],
        message: "A scan recipe needs an extract_candidates step",
      });
    }
    if (recipe.purpose === "remove" && extracts) {
      ctx.addIssue({
        code: "custom",
        path: ["steps"],
        message: "Only a scan recipe may extract candidates",
      });
    }
  });
export type Recipe = z.infer<typeof Recipe>;

/** A recipe as stored by the server, with its review state and health. */
export const RecipeRecord = z.object({
  id: z.string(),
  targetId: z.string(),
  targetName: z.string(),
  purpose: RecipePurpose,
  version: z.number().int().positive(),
  source: RecipeSource,
  status: RecipeStatus,
  health: RecipeHealth,
  failureCount: z.number().int().nonnegative(),
  lastCheckedAt: z.iso.datetime().nullable(),
  notes: z.string().nullable(),
  createdAt: z.iso.datetime(),
  definition: Recipe,
});
export type RecipeRecord = z.infer<typeof RecipeRecord>;
