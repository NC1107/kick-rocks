import {
  HUMAN_PACE,
  INSTANT_PACE,
  type Pace,
  type RunOutcome,
  runCanary,
  runConfirmation,
  runRecipe,
} from "@kickrocks/recipes";
import {
  CanaryResult,
  type ClaimedTask,
  ConfirmResult,
  FormResult,
  MAX_SCREENSHOT_BYTES,
  type ProfileFields,
  type Recipe,
  ScanResult,
  type SiteObservation,
  type TaskBlockReport,
  type TaskFailureReport,
  type TaskUsage,
  WebUrl,
} from "@kickrocks/shared";
import type { Page } from "playwright";
import type { z } from "zod";
import { ProxyConflictError } from "./browser.js";
import { describeError, type Logger } from "./logger.js";

/** What to tell the server about a task after running it. */
export type TaskReport =
  | { kind: "complete"; result: unknown; usage: TaskUsage; site?: SiteObservation }
  | { kind: "block"; report: TaskBlockReport }
  | { kind: "fail"; report: Omit<TaskFailureReport, "kind"> & { kind?: TaskFailureReport["kind"] } }
  /** Hand the task back without costing it an attempt. */
  | { kind: "release"; reason: string; retryAfterMs?: number };

/** What a run tells the loop that carries it, beyond the report it ends with. */
export interface RunProgress {
  /**
   * Called before the run does something that may submit a form. Resolves once the server has
   * acknowledged it, so a lease that is lost afterwards holds the task for a person and does not
   * retry it. Rejects with `SubmitNotRecorded` when it could not, and then the run must not click.
   */
  mayHaveSubmitted(): Promise<void>;
}

/** The server did not acknowledge that a run may submit a form, so the run must not click. */
export class SubmitNotRecorded extends Error {
  override name = "SubmitNotRecorded";

  constructor(reason: string) {
    super(`The server could not be told a form may be submitted: ${reason}`);
  }
}

export type TaskExecutor = (
  task: ClaimedTask,
  signal: AbortSignal,
  progress?: RunProgress,
) => Promise<TaskReport>;

export interface Runners {
  runRecipe: typeof runRecipe;
  runCanary: typeof runCanary;
  runConfirmation: typeof runConfirmation;
}

interface ExecutorOptions {
  /**
   * Opens a page in the browser that belongs to the person the task is for, reaching the web
   * through `proxy` when the person routed this site through one.
   */
  openPage: (profileId: string | null, proxy: string | null) => Promise<Page>;
  pace: "human" | "instant";
  allowHttp: boolean;
  logger: Logger;
  runners?: Runners;
  now?: () => number;
}

/** A browser that will not start is the worker's problem, not the task's, so it is not blamed on it. */
const BROWSER_UNAVAILABLE_RETRY_MS = 60_000;
/** An agent task is for a client with a model; handing it back keeps it available for one. */
const AGENT_TASK_RETRY_MS = 5 * 60_000;

const DEFAULT_RUNNERS: Runners = { runRecipe, runCanary, runConfirmation };

function internal(error: string, retryable: boolean): TaskReport {
  return { kind: "fail", report: { error, retryable, kind: "internal" } };
}

/** The address the person should open to finish by hand, when the page is a web page. */
function blockedUrl(page: Page): string | undefined {
  const parsed = WebUrl.safeParse(page.url());
  return parsed.success ? parsed.data : undefined;
}

function screenshotOf(buffer: Buffer | null): TaskBlockReport["screenshot"] {
  if (buffer === null || buffer.length === 0 || buffer.length > MAX_SCREENSHOT_BYTES) {
    return undefined;
  }
  return { mime: "image/png", dataBase64: buffer.toString("base64") };
}

function report<R>(
  outcome: RunOutcome<R>,
  schema: z.ZodType,
  page: Page,
  usage: TaskUsage,
  signal: AbortSignal,
): TaskReport {
  const site = outcome.site ? { site: outcome.site } : {};
  switch (outcome.status) {
    case "completed": {
      const parsed = schema.safeParse(outcome.result);
      return parsed.success
        ? { kind: "complete", result: parsed.data, usage, ...site }
        : internal("The run produced a result that does not match its schema", false);
    }
    case "blocked": {
      const url = blockedUrl(page);
      const screenshot = screenshotOf(outcome.screenshot);
      return {
        kind: "block",
        report: {
          reason: outcome.reason,
          detail: outcome.detail.slice(0, 2000),
          ...(url ? { url } : {}),
          ...(screenshot ? { screenshot } : {}),
          usage,
          ...site,
        },
      };
    }
    case "failed":
      if (signal.aborted) return { kind: "release", reason: "the worker is shutting down" };
      return {
        kind: "fail",
        report: {
          error: outcome.error.slice(0, 2000) || "The run failed",
          retryable: outcome.retryable,
          kind: outcome.kind,
          ...(outcome.step === undefined ? {} : { step: outcome.step }),
          usage,
          ...site,
        },
      };
  }
}

/** Fields for a removal: the record URL the task names, in case the claim left it out of `fields`. */
function fieldsFor(task: ClaimedTask, recipe: Recipe): ProfileFields {
  const fields = { ...task.fields };
  if (
    task.kind === "form" &&
    recipe.fields.includes("record_url") &&
    fields.record_url === undefined &&
    task.payload.recordUrl !== null
  ) {
    fields.record_url = task.payload.recordUrl;
  }
  return fields;
}

/**
 * Runs one claimed task in a fresh browser tab and decides what to report. A scan or form runs its
 * recipe, a canary checks it, and a confirm opens the emailed link. It never throws: anything that
 * goes wrong becomes a failure report, so the claim loop always has something to tell the server.
 */
export function createExecutor(options: ExecutorOptions): TaskExecutor {
  const runners = options.runners ?? DEFAULT_RUNNERS;
  const now = options.now ?? Date.now;
  const pace: Pace = options.pace === "instant" ? INSTANT_PACE : HUMAN_PACE;

  return async (task, signal, progress) => {
    if (task.kind === "agent") {
      return {
        kind: "release",
        reason: "agent tasks are for an agent client",
        retryAfterMs: AGENT_TASK_RETRY_MS,
      };
    }
    if ((task.kind === "scan" || task.kind === "form" || task.kind === "canary") && !task.recipe) {
      return internal(`The ${task.kind} task has no recipe to run`, false);
    }
    const recipe = task.recipe;
    if (task.kind === "scan" && recipe?.purpose !== "scan") {
      return internal("A scan task needs a scan recipe", false);
    }
    if (task.kind === "form" && recipe?.purpose !== "remove") {
      return internal("A form task needs a remove recipe", false);
    }

    let page: Page;
    try {
      page = await options.openPage(task.profileId ?? null, task.proxyUrl ?? null);
    } catch (error) {
      if (error instanceof ProxyConflictError) return internal(error.message, false);
      options.logger.error("could not open a browser page", { error: describeError(error) });
      return {
        kind: "release",
        reason: "the browser is not available",
        retryAfterMs: BROWSER_UNAVAILABLE_RETRY_MS,
      };
    }

    const started = now();
    const usage = (): TaskUsage => ({ durationMs: Math.max(0, now() - started) });
    try {
      const shared = {
        page,
        pace,
        signal,
        allowHttp: options.allowHttp,
        targetDomain: task.target.domain,
      };
      switch (task.kind) {
        case "scan": {
          const outcome = await runners.runRecipe({
            ...shared,
            recipe: recipe as Recipe & { purpose: "scan" },
            fields: fieldsFor(task, recipe as Recipe),
          });
          return report(outcome, ScanResult, page, usage(), signal);
        }
        case "form": {
          const outcome = await runners.runRecipe({
            ...shared,
            ...(progress ? { onSubmit: progress.mayHaveSubmitted } : {}),
            recipe: recipe as Recipe & { purpose: "remove" },
            fields: fieldsFor(task, recipe as Recipe),
          });
          return report(outcome, FormResult, page, usage(), signal);
        }
        case "canary": {
          const outcome = await runners.runCanary({ ...shared, recipe: recipe as Recipe });
          return report(outcome, CanaryResult, page, usage(), signal);
        }
        case "confirm": {
          const outcome = await runners.runConfirmation({ ...shared, url: task.payload.url });
          return report(outcome, ConfirmResult, page, usage(), signal);
        }
      }
    } catch (error) {
      if (signal.aborted) return { kind: "release", reason: "the worker is shutting down" };
      options.logger.error("a task run threw", { taskId: task.id, error: describeError(error) });
      return internal(describeError(error) || "The run failed", true);
    } finally {
      await page.close().catch(() => undefined);
    }
  };
}
