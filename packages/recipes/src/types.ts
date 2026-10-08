import type {
  BlockedReason,
  CanaryResult,
  FailureKind,
  FormResult,
  ProfileFields,
  Recipe,
  RecipePurpose,
  ScanResult,
  SiteObservation,
} from "@kickrocks/shared";
import type { Page } from "playwright";

/**
 * How a run ends. A run that hits a CAPTCHA, phone or ID demand, login wall, or bot check is
 * blocked for a human rather than failed, and carries the evidence a person needs.
 *
 * A failure says what broke, because the server counts only `recipe` failures against a recipe's
 * health and hands the task to an agent for them. A recipe failure (a selector that is gone, an
 * `expect_text` that did not hold) is always reported with `retryable: false`, since running the
 * same script again cannot help; `step` is the index of the step that failed. A `site` error or a
 * dropped `network` may be retried.
 */
export type RunOutcome<R> =
  | { status: "completed"; result: R; site?: SiteObservation | undefined }
  | {
      status: "blocked";
      reason: BlockedReason;
      detail: string;
      screenshot: Buffer | null;
      site?: SiteObservation | undefined;
    }
  | {
      status: "failed";
      kind: FailureKind;
      error: string;
      retryable: boolean;
      step?: number | undefined;
      site?: SiteObservation | undefined;
    };

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
