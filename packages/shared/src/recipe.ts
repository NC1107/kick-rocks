import { z } from "zod";
import { ProfileField } from "./identities.js";
import { isSharedMailHost } from "./mail-hosts.js";
import { BlockedReason, FormOutcome } from "./outcomes.js";
import { templateFields, templateProblem } from "./template.js";
import { WebUrl } from "./url.js";

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

/**
 * Scripts only ever navigate to web pages; a recipe is data and must not smuggle in other schemes.
 * The one exception is a url that is exactly `{{record_url}}`, which a remove recipe uses to open
 * the record the person confirmed. The runner checks the rendered value before it navigates: https
 * only, and a host equal to the target's domain or one of its subdomains.
 */
const RECORD_URL_TEMPLATE = /^\{\{\s*record_url\s*\}\}$/;
const GotoUrl = z
  .string()
  .refine((url) => /^https?:\/\//.test(url) || RECORD_URL_TEMPLATE.test(url), {
    message: "Must start with http:// or https://, or be exactly {{record_url}}",
  });

const Locator = z.object({
  role: z.string().min(1).optional(),
  label: z.string().min(1).optional(),
  testId: z.string().min(1).optional(),
  css: z.string().min(1).optional(),
  text: z.string().min(1).optional(),
});

/** Locators in order of preference: role and label, test id, CSS, then visible text. */
export const Selector = Locator.strict().refine(
  (s) => Object.values(s).some((v) => v !== undefined),
  { message: "A selector needs at least one of role, label, testId, css, or text" },
);
export type Selector = z.infer<typeof Selector>;

/** Where to read one candidate field, relative to the candidate's container element. */
export const CandidateField = z
  .object({
    css: z.string().min(1),
    /** Read this attribute instead of the element's text. */
    attr: z.string().min(1).optional(),
    /** Collect every match into a list instead of the first. */
    all: z.boolean().optional(),
  })
  .strict();
export type CandidateField = z.infer<typeof CandidateField>;

/**
 * Every step is strict, so a key the schema does not know fails validation instead of being
 * dropped, which would otherwise turn an author's `optional: true` typo into a mandatory step.
 */
const step = <K extends string, S extends z.ZodRawShape>(kind: K, shape: S) =>
  z.object({ kind: z.literal(kind), ...shape }).strict();

/** The selector of an iframe that holds the target, for forms embedded in a frame. */
const frame = { frame: Selector.optional() };
/**
 * An optional step is skipped when its target does not appear within a short timeout, which is
 * how a recipe deals with a cookie banner or an interstitial that only shows up sometimes.
 */
const optionalStep = { optional: z.boolean().default(false) };

const exactlyOne = (a: string, b: string) => (s: Record<string, unknown>) =>
  (s[a] === undefined) !== (s[b] === undefined);

const Goto = step("goto", { url: GotoUrl });
const Fill = step("fill", {
  target: Selector,
  field: ProfileField.optional(),
  /** A template such as "{{first_name}} {{last_name}}", used instead of a single field. */
  value: z.string().min(1).optional(),
  ...frame,
  ...optionalStep,
}).refine(exactlyOne("field", "value"), {
  message: "A fill step needs exactly one of field or value",
});
const Select = step("select", {
  target: Selector,
  field: ProfileField.optional(),
  /** A template, for an option that is not a profile field such as a removal reason. */
  value: z.string().min(1).optional(),
  /** Match the option's value attribute or its visible label. */
  by: z.enum(["value", "label"]).default("label"),
  ...frame,
  ...optionalStep,
}).refine(exactlyOne("field", "value"), {
  message: "A select step needs exactly one of field or value",
});
const Click = step("click", { target: Selector, ...frame, ...optionalStep });
const Check = step("check", {
  target: Selector,
  checked: z.boolean().default(true),
  ...frame,
  ...optionalStep,
});
const Press = step("press", {
  key: z.string().min(1),
  target: Selector.optional(),
  ...frame,
  ...optionalStep,
});
const Pause = step("pause", {
  minMs: z.number().int().nonnegative(),
  maxMs: z.number().int().nonnegative(),
}).refine((s) => s.minMs <= s.maxMs, { message: "minMs must not exceed maxMs" });
const WaitFor = step("wait_for", {
  target: Selector,
  timeoutMs: z.number().int().positive().optional(),
  state: z.enum(["visible", "hidden", "attached", "detached"]).default("visible"),
  ...frame,
  ...optionalStep,
});
const ExpectText = step("expect_text", { text: z.string().min(1) });

const RegexSource = z.string().refine(
  (source) => {
    try {
      new RegExp(source);
      return true;
    } catch {
      return false;
    }
  },
  { message: "Must be a valid regular expression" },
);
const ExpectUrl = step("expect_url", {
  /** A regular expression tested against the page URL. */
  pattern: RegexSource,
});
const ExtractCandidates = step("extract_candidates", {
  item: Selector,
  fields: z
    .object({
      recordUrl: CandidateField,
      name: CandidateField,
      age: CandidateField.optional(),
      locations: CandidateField.optional(),
      relatives: CandidateField.optional(),
      phones: CandidateField.optional(),
      emails: CandidateField.optional(),
    })
    .strict(),
  ...frame,
});
const ExtractText = step("extract_text", {
  target: Selector,
  as: z.enum(["confirmation_text", "record_url"]),
  ...frame,
});
/**
 * Finds the result whose link is the record the person confirmed and acts on it, which is how a
 * search-then-select site is removed. Each item's `link` is read, both sides are compared through
 * `normalizeRecordUrl`, and the matching item is clicked or checked. When no item matches and the
 * recipe says its result list is `exhaustive`, the run ends as a completed run with the form
 * outcome `not_found`, because the record is already gone. Otherwise the run stops for a person,
 * because a page that lists other results, or links in another shape than the scan read, is no
 * proof that the record is gone.
 */
const SelectRecord = step("select_record", {
  item: Selector,
  link: CandidateField,
  action: z.enum(["click", "check"]),
  /** The author saw that the list holds every match and links in the shape a scan reads. */
  exhaustive: z.boolean().default(false),
  ...frame,
});
const OutcomeCondition = z
  .object({
    text: z.string().min(1).optional(),
    selector: Selector.optional(),
    urlPattern: RegexSource.optional(),
    outcome: z.enum([...FormOutcome.options, "blocked"]),
    reason: BlockedReason.optional(),
  })
  .strict()
  .refine((c) => c.text !== undefined || c.selector !== undefined || c.urlPattern !== undefined, {
    message: "A condition needs at least one of text, selector, or urlPattern",
  })
  .refine((c) => (c.outcome === "blocked") === (c.reason !== undefined), {
    message: "A blocked outcome needs a reason, and no other outcome has one",
  });
/**
 * Ends the run with the outcome of the first condition that matches the page, so a recipe can
 * report "not found", "already removed", or a human check without failing. A remove run that
 * reaches the end without a match is a recipe failure unless an `expect_text` or `expect_url` after
 * its last submit held, so a form the site rejected is never reported as sent.
 */
const OutcomeWhen = step("outcome_when", {
  when: z.array(OutcomeCondition).min(1).max(10),
  /**
   * For a page that shows either one of these outcomes or the next step, where the outcome can
   * come late. The check then waits as long as a wait_for would, and carries on as soon as this
   * shows, instead of giving up on the outcomes after the short settle time.
   */
  continueWhen: Selector.optional(),
});
const CaptchaCheckpoint = step("captcha_checkpoint", {});
const EmailConfirmation = step("email_confirmation", {
  fromDomain: z
    .string()
    .min(1)
    .refine(
      (host) => !isSharedMailHost(host),
      "a shared mail host cannot vouch for a confirmation",
    ),
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
  SelectRecord,
  OutcomeWhen,
  CaptchaCheckpoint,
  EmailConfirmation,
]);
export type RecipeStep = z.infer<typeof RecipeStep>;

const NoTemplate = z
  .string()
  .min(1)
  .max(100)
  .refine((value) => !value.includes("{{"), { message: "A canary uses a literal value" });

/**
 * What a canary may do before it checks selectors: load a page, type a generic name, search, and
 * wait. It never uses profile fields, so a health check cannot disclose anyone, and it is only
 * allowed in a scan recipe, where clicking means searching rather than submitting a removal.
 */
const CanaryStep = z.discriminatedUnion("kind", [
  step("goto", { url: WebUrl }),
  step("fill", { target: Selector, value: NoTemplate, ...frame, ...optionalStep }),
  Click,
  WaitFor,
]);
export type CanaryStep = z.infer<typeof CanaryStep>;

export function recipeId(brokerId: string, purpose: RecipePurpose, version: number): string {
  return `${brokerId}.${purpose}.v${version}`;
}

/** The templates a step renders, so each can be checked for syntax and for the fields it names. */
function templatesOf(step: RecipeStep): string[] {
  switch (step.kind) {
    case "goto":
      return [step.url];
    case "fill":
    case "select":
      return step.value === undefined ? [] : [step.value];
    default:
      return [];
  }
}

/** Profile fields a step reads, whether named directly or through a template. */
function fieldsUsedBy(step: RecipeStep): string[] {
  switch (step.kind) {
    case "goto":
      return templateFields(step.url);
    case "fill":
    case "select":
      return step.field ? [step.field] : templateFields(step.value ?? "");
    case "select_record":
      return ["record_url"];
    default:
      return [];
  }
}

/** Steps that send something to the site, after which a remove recipe must see proof it took. */
function submits(step: RecipeStep): boolean {
  return (
    step.kind === "click" ||
    step.kind === "press" ||
    (step.kind === "select_record" && step.action === "click")
  );
}

/** Whether a step shows the site accepted a submission, as opposed to merely not complaining. */
function proves(step: RecipeStep): boolean {
  return (
    step.kind === "expect_text" ||
    step.kind === "expect_url" ||
    (step.kind === "outcome_when" &&
      step.when.some(
        (c) => c.outcome === "submitted" || c.outcome === "awaiting_email_confirmation",
      ))
  );
}

/**
 * A recipe whose last step can only end the run as blocked never reports the request as sent: a
 * page that matches none of its conditions fails the run. It is how a flow stops before a step
 * that must not run unattended, so it needs no proof of acceptance.
 */
function endsBlocked(step: RecipeStep | undefined): boolean {
  return step?.kind === "outcome_when" && step.when.every((c) => c.outcome === "blocked");
}

/** A template in the host would let a value decide which site receives the person's details. */
const TEMPLATED_HOST = /^https?:\/\/[^/?#]*\{\{/;

export const Recipe = z
  .object({
    /** `<brokerId>.<purpose>.v<version>`, also the file name without its extension. */
    id: z.string().min(1),
    brokerId: z.string().min(1),
    /** Other brokers this recipe also serves, for a suppression center that covers sister sites. */
    alsoFor: z.array(z.string().min(1)).default([]),
    version: z.number().int().positive(),
    purpose: RecipePurpose,
    entryUrl: WebUrl,
    fields: z.array(ProfileField),
    steps: z.array(RecipeStep).min(1).max(100),
    canary: z
      .object({
        url: WebUrl,
        selectors: z.array(Selector).min(1),
        /**
         * What a check that only loads the page at `entryUrl` looks for. A canary never searches,
         * so selectors that exist only on a results page cannot be checked and are not listed here.
         * Without any, the check is that the page loads and is not a bot check.
         */
        entrySelectors: z.array(Selector).default([]),
        /** Gets a canary past a search form to the selectors that only exist on its results page. */
        steps: z.array(CanaryStep).max(10).default([]),
      })
      .strict(),
    notes: z.string().nullable().default(null),
    /** The day the author last checked this recipe against the live site. */
    verifiedAt: z.iso.date().nullable().default(null),
    liveStatus: RecipeLiveStatus.default("unverified"),
  })
  .strict()
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
      for (const template of templatesOf(step)) {
        const problem = templateProblem(template);
        if (problem) ctx.addIssue({ code: "custom", path: ["steps", index], message: problem });
      }
      if (step.kind === "goto" && TEMPLATED_HOST.test(step.url)) {
        ctx.addIssue({
          code: "custom",
          path: ["steps", index],
          message: "The host of a url must be written out, not filled from a template",
        });
      }
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

    const kinds = new Set(recipe.steps.map((s) => s.kind));
    if (recipe.purpose === "scan") {
      if (!kinds.has("extract_candidates")) {
        ctx.addIssue({
          code: "custom",
          path: ["steps"],
          message: "A scan recipe needs an extract_candidates step",
        });
      }
      if (declared.has("record_url")) {
        ctx.addIssue({
          code: "custom",
          path: ["fields"],
          message: "A scan finds the record, so it cannot start from record_url",
        });
      }
      for (const kind of ["select_record", "email_confirmation"] as const) {
        if (kinds.has(kind)) {
          ctx.addIssue({
            code: "custom",
            path: ["steps"],
            message: `Only a remove recipe may use ${kind}`,
          });
        }
      }
      recipe.steps.forEach((step, index) => {
        if (step.kind === "outcome_when" && step.when.some((c) => c.outcome !== "blocked")) {
          ctx.addIssue({
            code: "custom",
            path: ["steps", index],
            message: "A scan can only end a run as blocked",
          });
        }
      });
    } else {
      if (kinds.has("extract_candidates")) {
        ctx.addIssue({
          code: "custom",
          path: ["steps"],
          message: "Only a scan recipe may extract candidates",
        });
      }
      const lastSubmit = recipe.steps.findLastIndex(submits);
      const last = recipe.steps[recipe.steps.length - 1];
      if (
        !endsBlocked(last) &&
        !recipe.steps.some((step, index) => index > lastSubmit && proves(step))
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["steps"],
          message:
            "A remove recipe needs an expect_text, expect_url, or outcome_when with a submitted outcome after its last click, so a run proves the site accepted the request",
        });
      }
      if (recipe.canary.steps.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["canary", "steps"],
          message: "Only a scan recipe may have canary steps, because a click there is a search",
        });
      }
    }
    if (recipe.alsoFor.includes(recipe.brokerId)) {
      ctx.addIssue({
        code: "custom",
        path: ["alsoFor"],
        message: "alsoFor lists other brokers, not the recipe's own",
      });
    }
  });
export type Recipe = z.infer<typeof Recipe>;
/** A recipe as an author writes it, before the defaults for optional steps, states, and notes are filled in. */
export type RecipeInput = z.input<typeof Recipe>;

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
