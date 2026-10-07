import {
  type CanaryResult,
  type FormResult,
  type ProfileFields,
  type Recipe,
  type RecipePurpose,
  type RecipeStep,
  type ScanResult,
  templateFields,
} from "@kickrocks/shared";
import type { Page } from "playwright";
import type { RecipeResultFor, RunCanaryInput, RunOutcome, RunRecipeInput } from "../types.js";
import { blockedBy, createContext, guard, hostOf, type RunContext } from "./context.js";
import { detectBlockAfterGrace } from "./detect.js";
import { isClosedError, RunAborted, RunFailure, toFailure } from "./errors.js";
import { describeSelector, existsWithin } from "./locate.js";
import type { RunnerOptions } from "./options.js";
import { formResult, openPage, runStep } from "./steps.js";

export { runConfirmation } from "./confirm.js";
export { classifySignals, detectBlock, interstitialIn } from "./detect.js";
export { RunFailure } from "./errors.js";
export { MAX_CANDIDATES } from "./extract.js";
export { describeSelector } from "./locate.js";
export { DEFAULT_TIMEOUTS, type RunnerOptions, type Timeouts } from "./options.js";
export { HUMAN_PACE, INSTANT_PACE, type Pace, sleepFor } from "./pacing.js";
export { createRedactor } from "./redact.js";

/** The fields a step needs before it can run, so a missing one stops the run before anything is typed. */
function requiredFields(step: RecipeStep): string[] {
  if ("optional" in step && step.optional === true) return [];
  switch (step.kind) {
    case "goto":
      return templateFields(step.url);
    case "fill":
    case "select":
      return step.field === undefined ? templateFields(step.value ?? "") : [step.field];
    case "select_record":
      return ["record_url"];
    default:
      return [];
  }
}

const FIELD_LABELS: Record<string, string> = {
  first_name: "a first name",
  last_name: "a last name",
  full_name: "a name",
  email: "an email address",
  phone: "a phone number",
  city: "an address with a city",
  state: "an address with a state",
  zip: "an address with a ZIP code",
  street: "an address with a street",
  birth_year: "a date of birth",
  date_of_birth: "a date of birth",
  record_url: "a record link",
};

function describeMissing(names: string[]): string {
  const labels = [...new Set(names.map((name) => FIELD_LABELS[name] ?? name))];
  return `This site needs ${labels.join(" and ")} on the profile. Add it on the profile page, then retry.`;
}

function missingFields(recipe: Recipe, fields: ProfileFields): string[] {
  const needed = new Set(recipe.steps.flatMap(requiredFields));
  return Array.from(needed).filter((name) => fields[name as keyof ProfileFields] === undefined);
}

function failed(ctx: RunContext, failure: RunFailure): RunOutcome<never> {
  return {
    status: "failed",
    kind: failure.kind,
    error: ctx.redact(failure.message),
    // The same script would fail the same way, so a recipe failure is never worth another attempt.
    retryable: failure.kind === "recipe" ? false : failure.retryable,
    step: failure.step,
  };
}

/**
 * What a run reports when something threw. A page that stopped the run for a human check is
 * reported as blocked even when the failure looked like a missing selector, because the CAPTCHA
 * is the reason the form was not there.
 */
async function outcomeOfError(ctx: RunContext, error: unknown): Promise<RunOutcome<never>> {
  if (error instanceof RunAborted || ctx.signal?.aborted) {
    return { status: "failed", kind: "internal", error: "The run was aborted", retryable: true };
  }
  const failure = toFailure(error);
  if (failure.kind === "recipe" || failure.kind === "site") {
    try {
      const finding = await detectBlockAfterGrace(ctx.page, {
        graceMs: ctx.timeouts.challengeGraceMs,
        signal: ctx.signal,
      });
      if (finding !== null) return await blockedBy(ctx, finding);
    } catch (probeError) {
      if (isClosedError(probeError)) return failed(ctx, toFailure(probeError));
    }
  }
  return failed(ctx, failure);
}

/** Dialogs such as "are you sure" would stall every action, and a removal wants them accepted. */
function acceptDialogs(page: Page): () => void {
  const handler = (dialog: { accept: () => Promise<void> }) => {
    dialog.accept().catch(() => undefined);
  };
  page.on("dialog", handler);
  return () => page.off("dialog", handler);
}

function finish(ctx: RunContext, recipe: Recipe): RunOutcome<FormResult | ScanResult> {
  if (recipe.purpose === "scan") {
    return { status: "completed", result: { candidates: ctx.state.candidates } };
  }
  const outcome =
    ctx.state.awaitingEmailFrom === undefined ? "submitted" : "awaiting_email_confirmation";
  return { status: "completed", result: formResult(ctx, outcome) };
}

/**
 * Runs a scan or remove recipe to the end. It opens the entry page, runs each step in order, and
 * reports a typed result, a block for a person, or a typed failure. It never throws for a problem
 * with the page or the recipe.
 */
export async function runRecipe<P extends RecipePurpose>(
  input: RunRecipeInput<P> & RunnerOptions,
): Promise<RunOutcome<RecipeResultFor<P>>> {
  const { page, recipe, fields } = input;
  const ctx = createContext(page, fields, hostOf(recipe.entryUrl), input);
  const missing = missingFields(recipe, ctx.fields);
  if (missing.length > 0) {
    return failed(ctx, new RunFailure("internal", describeMissing(missing), false));
  }
  const stopDialogs = acceptDialogs(page);
  try {
    const first = recipe.steps[0];
    const startsAtEntry = first?.kind === "goto" && first.url === recipe.entryUrl;
    if (!startsAtEntry) {
      const stopped = await openPage(ctx, recipe.entryUrl);
      if (stopped) return stopped as RunOutcome<RecipeResultFor<P>>;
    }
    for (const [index, step] of recipe.steps.entries()) {
      const ended = await runStep(ctx, step, index);
      if (ended) return ended as RunOutcome<RecipeResultFor<P>>;
    }
    return finish(ctx, recipe) as RunOutcome<RecipeResultFor<P>>;
  } catch (error) {
    return outcomeOfError(ctx, error);
  } finally {
    stopDialogs();
  }
}

/**
 * Opens a recipe's canary page, runs its search steps, and checks that every selector is still
 * there. It never submits anything and never uses a profile field. A page that shows a human check
 * is reported as blocked, because the selectors cannot be judged behind it.
 */
export async function runCanary(
  input: RunCanaryInput & RunnerOptions,
): Promise<RunOutcome<CanaryResult>> {
  const { page, recipe } = input;
  const ctx = createContext(page, {}, hostOf(recipe.entryUrl), input);
  const stopDialogs = acceptDialogs(page);
  try {
    const stopped = await openPage(ctx, recipe.canary.url);
    if (stopped) return stopped as RunOutcome<CanaryResult>;
    for (const [index, step] of recipe.canary.steps.entries()) {
      try {
        const ended = await runStep(ctx, step as RecipeStep, index);
        if (ended) return ended as RunOutcome<CanaryResult>;
      } catch (error) {
        if (error instanceof RunFailure && error.kind === "recipe" && "target" in step) {
          return canaryResult(ctx, [describeSelector(step.target)]);
        }
        throw error;
      }
    }
    const checks = await Promise.all(
      recipe.canary.selectors.map(async (selector) => ({
        selector,
        found: await existsWithin(page, selector, {
          timeoutMs: ctx.timeouts.stepMs,
          signal: ctx.signal,
          visibleOnly: false,
        }),
      })),
    );
    const missing = checks.filter((check) => !check.found).map((c) => describeSelector(c.selector));
    return canaryResult(ctx, missing);
  } catch (error) {
    return outcomeOfError(ctx, error);
  } finally {
    stopDialogs();
  }
}

async function canaryResult(ctx: RunContext, missing: string[]): Promise<RunOutcome<CanaryResult>> {
  if (missing.length > 0) {
    const stopped = await guard(ctx);
    if (stopped) return stopped;
  }
  return {
    status: "completed",
    result: { healthy: missing.length === 0, missingSelectors: missing },
  };
}
