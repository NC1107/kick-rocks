import type {
  BlockedReason,
  CanaryResult,
  FormResult,
  ProfileFields,
  Recipe,
  RecipePurpose,
  ScanResult,
} from "@kickrocks/shared";
import type { Page } from "playwright";

/**
 * How a run ends. A run that hits a CAPTCHA, phone or ID demand, login wall, or bot check is
 * blocked for a human rather than failed, and carries the evidence a person needs.
 */
export type RunOutcome<R> =
  | { status: "completed"; result: R }
  | { status: "blocked"; reason: BlockedReason; detail: string; screenshot: Buffer | null }
  | { status: "failed"; error: string; retryable: boolean };

export type RecipeResultFor<P extends RecipePurpose> = P extends "scan" ? ScanResult : FormResult;

export interface RunRecipeInput<P extends RecipePurpose = RecipePurpose> {
  page: Page;
  recipe: Recipe & { purpose: P };
  /** Exactly the fields the recipe declares, resolved by the server at claim time. */
  fields: ProfileFields;
}

/** Runs a scan or remove recipe to the end and reports a typed result. */
export type RecipeRunner = <P extends RecipePurpose>(
  input: RunRecipeInput<P>,
) => Promise<RunOutcome<RecipeResultFor<P>>>;

export interface RunCanaryInput {
  page: Page;
  recipe: Recipe;
}

/** Loads a recipe's canary page and checks its selectors without submitting anything. */
export type CanaryRunner = (input: RunCanaryInput) => Promise<RunOutcome<CanaryResult>>;
