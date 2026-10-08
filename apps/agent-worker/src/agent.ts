import type { Pace } from "@kickrocks/recipes";
import {
  type ClaimedTask,
  FormResult,
  resultSchemaFor,
  ScanResult,
  type SiteObservation,
  type SubmitGate,
  type TaskUsage,
} from "@kickrocks/shared";
import { SubmitNotRecorded, type TaskReport } from "@kickrocks/worker/dist/executor.js";
import { describeError, type Logger } from "@kickrocks/worker/dist/logger.js";
import type { Page } from "playwright";
import type { z } from "zod";
import type { AgentLimits, Pricing } from "./config.js";
import { type AllowedSites, allowedSitesFor, describeSites, withinSites } from "./domains.js";
import { createMask, namedHiddenValues, restoreFields } from "./mask.js";
import { ApprovalLapsed, UnguardedChannel } from "./outbound/guard.js";
import type { SendsApi } from "./outbound/held.js";
import { buildOpeningMessage, buildSystemPrompt, startUrlFor } from "./prompt.js";
import {
  type Message,
  type ModelProvider,
  ProviderError,
  type ToolCall,
  type ToolResult,
} from "./provider.js";
import { Toolbox, type ToolOutcome } from "./toolbox.js";
import { ReportArgs, TOOL_SPECS } from "./tools.js";

type AgentTask = Extract<ClaimedTask, { kind: "agent" }>;

interface AgentRunOptions {
  task: AgentTask;
  page: Page;
  provider: ModelProvider;
  limits: AgentLimits;
  pricing: Pricing | null;
  pace: Pace;
  allowHttp: boolean;
  maxOutputTokens: number;
  signal: AbortSignal;
  logger: Logger;
  now?: () => number;
  challengeGraceMs?: number;
  actionTimeoutMs?: number;
  /**
   * Awaited before each click of a removal run whose sends are not held, so the server knows the
   * form may be submitted. A held run needs no flag: the server hears of every send itself.
   */
  onMayHaveSubmitted?: () => Promise<void>;
  /** How the gate talks to the server. A removal run with a gate cannot start without it. */
  sends?: SendsApi;
  /** Shortens how long a send waits for a person, which only a test or a batch run wants. */
  holdMsCap?: number;
  maxScreenshotBytes?: number;
}

/** A model that is down is not the task's fault, so the task goes back unchanged, later. */
const MODEL_UNAVAILABLE_RETRY_MS = 60_000;
/** A wrong key or model name stays wrong, so the task waits longer before another try. */
const MODEL_MISCONFIGURED_RETRY_MS = 10 * 60_000;
/** A model that hands tasks back is no better placed an hour later, so a person gets time to look first. */
const MODEL_RELEASE_RETRY_MS = 60 * 60_000;
const SUBMIT_NOT_RECORDED_RETRY_MS = 60_000;
const MAX_TEXT_ONLY_TURNS = 3;
const DEFAULT_HOLD_MS = 10 * 60_000;
const LIVE_CONNECTION_COPY =
  "This site needs a live connection the safety gate does not allow. Finish it yourself, or clear the model.";
/** What the gate lets through without asking, said wherever a person is asked to trust it. */
const GATE_LIMITS_COPY =
  "The gate lets a name, city, state, ZIP, year or record link through in a search without asking, and it cannot see a value that the page itself scrambles, or splits into pieces, before sending it in a plain GET (it recognizes the whole value, the value backwards, a common hash, and any run of six or more characters in a row from an email, phone, street, date of birth or hidden value, but not a run that is only a name, place or common domain, and not a piece of five characters or fewer, so a short piece of a value goes out without asking), and it cannot stop a host name that carries a value from reaching a DNS server.";
const OMITTED_SNAPSHOT = "(An earlier page snapshot was left out. Use the latest one.)";
const NEEDS_A_CLICK = new Set(["submitted", "awaiting_email_confirmation"]);

function clip(text: string, length: number): string {
  return text.length > length ? `${text.slice(0, length - 3)}...` : text;
}

function describeIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "result"}: ${issue.message}`)
    .join("; ");
}

/**
 * How a removal run's outgoing requests are gated. A task that does not say is treated as needing
 * approval, so a missing field never opens the gate. A scan sends nothing and is not gated.
 */
function gateFor(task: AgentTask, holdMsCap: number | undefined): SubmitGate | undefined {
  if (task.payload.purpose !== "remove") return undefined;
  const gate =
    task.submitGate ??
    (task.submitApproval === "not_needed"
      ? undefined
      : ({
          mode: "hold",
          holdMs: DEFAULT_HOLD_MS,
          approved: [],
          declined: [],
        } satisfies SubmitGate));
  if (gate === undefined || holdMsCap === undefined) return gate;
  return { ...gate, holdMs: Math.min(gate.holdMs, holdMsCap) };
}

class AgentRun {
  private readonly started: number;
  private readonly now: () => number;
  private readonly sites: AllowedSites;
  private readonly fieldNames: string[];
  private readonly mask: (text: string) => string;
  /** What every placeholder the model may have copied stands for. */
  private readonly known: Record<string, string | undefined>;
  private readonly toolbox: Toolbox;
  private readonly messages: Message[] = [];
  private inputTokens = 0;
  private outputTokens = 0;
  private steps = 0;
  private modelAnswers = 0;
  /** Time spent waiting for a person, which is not the model's to spend. */
  private heldMs = 0;
  private lastSnapshot: ToolResult | null = null;

  constructor(private readonly options: AgentRunOptions) {
    this.now = options.now ?? Date.now;
    this.started = this.now();
    const { task } = options;
    this.sites = allowedSitesFor(task.target, [task.payload.recordUrl]);
    this.fieldNames = Object.entries(task.fields)
      .filter(([, value]) => value !== undefined && value !== "")
      .map(([name]) => name);
    this.mask = createMask(task.fields, task.maskValues);
    this.known = { ...task.fields, ...namedHiddenValues(task.fields, task.maskValues ?? []) };
    const gate = gateFor(task, options.holdMsCap);
    this.toolbox = new Toolbox({
      page: options.page,
      fields: task.fields,
      policy: { ...this.sites, allowHttp: options.allowHttp },
      startUrls: [startUrlFor(task)],
      pace: options.pace,
      mask: this.mask,
      signal: options.signal,
      ...(task.payload.purpose === "remove" && options.onMayHaveSubmitted && gate?.mode !== "hold"
        ? { onClick: options.onMayHaveSubmitted }
        : {}),
      ...(gate ? { gate } : {}),
      ...(options.sends ? { sends: options.sends } : {}),
      maskValues: task.maskValues ?? [],
      logger: options.logger,
      onHeld: (ms) => {
        this.heldMs += ms;
      },
      ...(options.maxScreenshotBytes === undefined
        ? {}
        : { maxScreenshotBytes: options.maxScreenshotBytes }),
      ...(options.actionTimeoutMs === undefined
        ? {}
        : { actionTimeoutMs: options.actionTimeoutMs }),
      ...(options.challengeGraceMs === undefined
        ? {}
        : { challengeGraceMs: options.challengeGraceMs }),
    });
  }

  get stepCount(): number {
    return this.steps;
  }

  /** What the browser saw of the site, for the server to pace the next visit. */
  private site(): { site: SiteObservation } | Record<string, never> {
    const site = this.toolbox.siteObservation();
    return site ? { site } : {};
  }

  private usage(): TaskUsage {
    const { pricing } = this.options;
    return {
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      durationMs: Math.max(0, this.activeMs()),
      ...(pricing
        ? {
            costUsd:
              (this.inputTokens * pricing.inputUsdPerMtok +
                this.outputTokens * pricing.outputUsdPerMtok) /
              1_000_000,
          }
        : {}),
    };
  }

  private release(reason: string, retryAfterMs?: number): TaskReport {
    return { kind: "release", reason, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) };
  }

  private fail(error: string, retryable = false): TaskReport {
    return {
      kind: "fail",
      report: {
        error: clip(this.mask(error), 2000),
        retryable,
        kind: "internal",
        usage: this.usage(),
      },
    };
  }

  private activeMs(): number {
    return this.now() - this.started - this.heldMs;
  }

  private budgetExceeded(): string | null {
    const { limits } = this.options;
    if (this.steps >= limits.maxSteps) {
      return `The agent used all ${limits.maxSteps} of its steps without finishing`;
    }
    if (this.activeMs() >= limits.maxMs) {
      return `The agent ran out of time after ${Math.round(limits.maxMs / 1000)} seconds`;
    }
    if (
      limits.maxTotalTokens !== null &&
      this.inputTokens + this.outputTokens >= limits.maxTotalTokens
    ) {
      return `The agent used its budget of ${limits.maxTotalTokens} tokens without finishing`;
    }
    return null;
  }

  async run(): Promise<TaskReport> {
    try {
      return await this.holdForPerson(await this.drive());
    } finally {
      await this.toolbox.dispose();
    }
  }

  /**
   * A removal run that has clicked may already have submitted the form. Handing the task back or
   * retrying it would submit again, so it goes to a person, who can see the page and the screenshot.
   */
  private async holdForPerson(report: TaskReport): Promise<TaskReport> {
    const { task, logger } = this.options;
    const wouldRetry =
      report.kind === "release" || (report.kind === "fail" && report.report.retryable);
    const mayHaveSent = this.toolbox.holdsSends
      ? this.toolbox.released > 0
      : this.toolbox.clicks > 0;
    if (!wouldRetry || task.payload.purpose !== "remove" || !mayHaveSent) {
      return report;
    }
    const cause = report.kind === "release" ? report.reason : report.report.error;
    logger.info("a removal run ended after a click, so a person decides", { taskId: task.id });
    const screenshot = await this.toolbox.screenshot();
    const url = this.toolbox.blockedUrl();
    return {
      kind: "block",
      report: {
        reason: "unknown",
        detail: clip(
          `The form may already have been submitted, so it was not retried. The run ended with: ${this.mask(cause)}`,
          2000,
        ),
        ...(url ? { url } : {}),
        ...(screenshot ? { screenshot } : {}),
        usage: this.usage(),
      },
    };
  }

  private async drive(): Promise<TaskReport> {
    const { task, signal, provider, logger } = this.options;
    const system = buildSystemPrompt({
      task: { ...task, instructions: this.mask(task.instructions) },
      sites: this.sites,
      fieldNames: this.fieldNames,
      maxSteps: this.options.limits.maxSteps,
    });
    this.messages.push({
      role: "user",
      text: this.mask(buildOpeningMessage(startUrlFor(task))),
    });
    await this.toolbox.install();
    try {
      let textOnlyTurns = 0;
      for (;;) {
        if (signal.aborted) return this.release("the worker is shutting down");
        if (this.options.page.isClosed()) {
          return this.fail("The browser page closed during the run", true);
        }
        await this.toolbox.settled();
        const exceeded = this.budgetExceeded();
        if (exceeded !== null) return this.fail(exceeded);

        const remainingMs = this.options.limits.maxMs - this.activeMs();
        const modelSignal = AbortSignal.any([
          signal,
          AbortSignal.timeout(Math.max(1, remainingMs)),
        ]);
        let response: Awaited<ReturnType<ModelProvider["complete"]>>;
        try {
          response = await provider.complete({
            system,
            messages: this.messages,
            tools: TOOL_SPECS,
            maxOutputTokens: this.options.maxOutputTokens,
            signal: modelSignal,
          });
        } catch (error) {
          if (signal.aborted) return this.release("the worker is shutting down");
          if (modelSignal.aborted)
            return this.fail("The agent ran out of time waiting for the model");
          return this.providerFailure(error);
        }
        this.modelAnswers += 1;
        this.inputTokens += response.usage.inputTokens;
        this.outputTokens += response.usage.outputTokens;
        this.messages.push({
          role: "assistant",
          text: response.text,
          toolCalls: response.toolCalls,
        });

        if (response.toolCalls.length === 0) {
          textOnlyTurns += 1;
          if (textOnlyTurns >= MAX_TEXT_ONLY_TURNS) {
            return this.fail("The model kept answering in text instead of using the tools");
          }
          this.messages.push({
            role: "user",
            text: "Use one of the tools. When you are done, call report.",
          });
          continue;
        }
        textOnlyTurns = 0;

        const ended = await this.handleCalls(response.toolCalls);
        if (ended !== null) return ended;
      }
    } catch (error) {
      if (signal.aborted) return this.release("the worker is shutting down");
      if (error instanceof ApprovalLapsed) return this.stopForApproval(error);
      if (error instanceof UnguardedChannel) return this.stopForChannel(error);
      if (error instanceof SubmitNotRecorded) {
        logger.warn("the server could not record a possible submission, so nothing was clicked", {
          taskId: task.id,
          error: describeError(error),
        });
        return this.release(error.message, SUBMIT_NOT_RECORDED_RETRY_MS);
      }
      logger.error("the agent run threw", { taskId: task.id, error: describeError(error) });
      return this.fail(describeError(error) || "The agent run failed", true);
    }
  }

  /**
   * A send waited for a person and nobody decided in time. The held requests were cancelled and
   * are left for the person to approve, and the run ends here, so nothing is ever retried blindly.
   */
  private async stopForApproval(lapsed: ApprovalLapsed): Promise<TaskReport> {
    const { task, logger, provider } = this.options;
    logger.info("a removal run stopped because a send was not decided in time", {
      taskId: task.id,
      model: provider.model,
      sends: lapsed.sends.length,
    });
    const screenshot = await this.toolbox.screenshot({ fullPage: true });
    const url = this.toolbox.blockedUrl();
    return {
      kind: "block",
      report: {
        reason: "approval_needed",
        detail: `${provider.model} has not passed the safety gate on this install, so a person approves each send, and nobody decided in time. ${lapsed.sends.length} ${lapsed.sends.length === 1 ? "request was" : "requests were"} cancelled and left for you to approve. ${GATE_LIMITS_COPY}`,
        ...(url ? { url } : {}),
        ...(screenshot ? { screenshot } : {}),
        usage: this.usage(),
      },
    };
  }

  /** The page opened a connection the gate cannot read, so the run ends where it is. */
  private async stopForChannel(channel: UnguardedChannel): Promise<TaskReport> {
    const { task, logger } = this.options;
    logger.info("a removal run stopped because the page opened a live connection", {
      taskId: task.id,
      afterTouch: channel.afterTouch,
    });
    const screenshot = await this.toolbox.screenshot();
    const url = this.toolbox.blockedUrl();
    return {
      kind: "block",
      report: {
        // After the run touched the page a form may have gone out through it, which only a
        // person can check, so the server parks it as a send nobody approved.
        reason: channel.afterTouch ? "approval_needed" : "unknown",
        detail: LIVE_CONNECTION_COPY,
        ...(url ? { url } : {}),
        ...(screenshot ? { screenshot } : {}),
        usage: this.usage(),
      },
    };
  }

  private providerFailure(error: unknown): TaskReport {
    const { logger, task, provider } = this.options;
    if (error instanceof ProviderError) {
      logger.warn("the model call failed", {
        taskId: task.id,
        provider: provider.name,
        kind: error.kind,
        status: error.status,
        error: describeError(error),
      });
      if (error.kind === "unavailable") {
        return this.release(error.message, MODEL_UNAVAILABLE_RETRY_MS);
      }
      if (error.kind === "config") {
        return this.release(error.message, MODEL_MISCONFIGURED_RETRY_MS);
      }
      // A refusal before the model has answered once is the setup, such as a parameter this model
      // does not take, and it would repeat for every task. Only a conversation that grew too long
      // is this task's own problem.
      if (this.modelAnswers === 0 || !error.contextTooLong) {
        return this.release(error.message, MODEL_MISCONFIGURED_RETRY_MS);
      }
      return this.fail(error.message);
    }
    return this.fail(describeError(error) || "The model call failed", true);
  }

  /** Runs the calls of one assistant turn in order. Every call gets an answer, as both APIs require. */
  private async handleCalls(calls: ToolCall[]): Promise<TaskReport | null> {
    const results: ToolResult[] = [];
    for (const call of calls) {
      this.steps += 1;
      const answered = await this.handleCall(call, results);
      if (answered !== null) return answered;
    }
    this.messages.push({ role: "tool", results });
    return null;
  }

  private async handleCall(call: ToolCall, results: ToolResult[]): Promise<TaskReport | null> {
    const { logger, task } = this.options;
    const answer = (content: string, isError: boolean, snapshot = false) => {
      const result: ToolResult = { callId: call.id, name: call.name, content, isError };
      if (snapshot) {
        if (this.lastSnapshot) this.lastSnapshot.content = OMITTED_SNAPSHOT;
        this.lastSnapshot = result;
      }
      results.push(result);
    };

    if (call.argsError !== undefined) {
      answer(call.argsError, true);
      return null;
    }
    logger.debug("tool call", { taskId: task.id, tool: call.name, step: this.steps });

    if (call.name === "report") return this.report(call, answer);
    if (this.steps > this.options.limits.maxSteps) {
      answer("The step budget is used up. Call report now.", true);
      return null;
    }

    const outcome: ToolOutcome = await this.toolbox.execute(call.name, call.args);
    if (outcome.kind === "challenge") {
      this.toolbox.noteChallenge(outcome.finding);
      const screenshot = await this.toolbox.screenshot();
      const url = this.toolbox.blockedUrl();
      logger.info("a human check stopped the run", {
        taskId: task.id,
        reason: outcome.finding.reason,
      });
      return {
        kind: "block",
        report: {
          reason: outcome.finding.reason,
          detail: clip(this.mask(outcome.finding.detail), 2000),
          ...(url ? { url } : {}),
          ...(screenshot ? { screenshot } : {}),
          usage: this.usage(),
          ...this.site(),
        },
      };
    }
    const refusal = this.toolbox.refusal;
    if (refusal) return this.stopForRefusal(refusal.status);
    answer(outcome.text, outcome.isError, outcome.snapshot);
    return null;
  }

  /**
   * A site that answered 429, 403 or 503 has asked for fewer requests. A model that reloaded or
   * tried another page would make more of them, so the run ends here and the server decides when
   * the site may be visited again.
   */
  private stopForRefusal(status: number): TaskReport {
    this.options.logger.info("the site pushed back, so the run stopped", {
      taskId: this.options.task.id,
      status,
    });
    return {
      kind: "fail",
      report: {
        error: `The site answered HTTP ${status}, so the run stopped instead of asking again.`,
        retryable: true,
        kind: "site",
        usage: this.usage(),
        ...this.site(),
      },
    };
  }

  private async report(
    call: ToolCall,
    answer: (content: string, isError: boolean) => void,
  ): Promise<TaskReport | null> {
    await this.toolbox.settled();
    const parsed = ReportArgs.safeParse(call.args);
    if (!parsed.success) {
      answer(`The report was not valid: ${describeIssues(parsed.error)}`, true);
      return null;
    }
    const report = parsed.data;
    switch (report.status) {
      case "complete": {
        const checked = this.checkResult(report.result);
        if ("error" in checked) {
          answer(checked.error, true);
          return null;
        }
        return { kind: "complete", result: checked.result, usage: this.usage(), ...this.site() };
      }
      case "blocked": {
        const screenshot = await this.toolbox.screenshot();
        const url = this.toolbox.blockedUrl();
        return {
          kind: "block",
          report: {
            reason: report.reason,
            ...(report.detail ? { detail: clip(this.mask(report.detail), 2000) } : {}),
            ...(url ? { url } : {}),
            ...(screenshot ? { screenshot } : {}),
            usage: this.usage(),
            ...this.site(),
          },
        };
      }
      case "failed":
        return {
          kind: "fail",
          report: {
            error: clip(this.mask(report.error), 2000),
            retryable: report.retryable,
            kind: report.failureKind,
            usage: this.usage(),
            ...this.site(),
          },
        };
      case "release":
        return this.release(
          report.reason || "the agent handed the task back",
          MODEL_RELEASE_RETRY_MS,
        );
    }
  }

  /** The result must fit the task's own purpose and be backed by what the run did. */
  private checkResult(raw: unknown): { result: unknown } | { error: string } {
    const { task } = this.options;
    const parsed = resultSchemaFor(task).safeParse(raw);
    if (!parsed.success) {
      return {
        error: `The result does not match the required shape: ${describeIssues(parsed.error)}`,
      };
    }
    const result = parsed.data as
      | { purpose: "scan"; scan: ScanResult }
      | { purpose: "remove"; form: FormResult };

    if (result.purpose === "scan") return this.checkScan(result.scan);
    if (NEEDS_A_CLICK.has(result.form.outcome) && this.toolbox.clicks === 0) {
      return {
        error: `The outcome ${result.form.outcome} needs the form to have been submitted, and nothing has been clicked. Do the work, or report failed.`,
      };
    }
    // Text copied from the page can echo the person's own details, and the server keeps it.
    const form = FormResult.parse({
      ...result.form,
      ...(result.form.confirmationText === undefined
        ? {}
        : { confirmationText: this.mask(result.form.confirmationText) }),
      ...(result.form.notes === undefined ? {} : { notes: this.mask(result.form.notes) }),
    });
    return { result: { purpose: "remove", form } };
  }

  /**
   * The model reads the page with the person's values hidden, so what it reports is in that hidden
   * form. The addresses are matched back to links the page really showed, and the placeholders in
   * the text are filled in, so the server stores what the page held and not the model's copy.
   */
  private checkScan(scan: ScanResult): { result: unknown } | { error: string } {
    const candidates: ScanResult["candidates"] = [];
    for (const candidate of scan.candidates) {
      if (!withinSites(candidate.recordUrl, this.sites)) {
        return {
          error: `A candidate is not on the target's domains (${describeSites(this.sites)}), so it was not accepted`,
        };
      }
      const recordUrl = this.toolbox.realLink(candidate.recordUrl);
      if (recordUrl === null || !withinSites(recordUrl, this.sites)) {
        return {
          error: `The address ${candidate.recordUrl} is not a link the pages you read showed. Copy each record link exactly as the snapshot shows it.`,
        };
      }
      const restore = (text: string) => restoreFields(text, this.known);
      candidates.push({
        ...candidate,
        recordUrl,
        name: restore(candidate.name),
        locations: candidate.locations.map(restore),
        ...(candidate.relatives ? { relatives: candidate.relatives.map(restore) } : {}),
        ...(candidate.phones ? { phones: candidate.phones.map(restore) } : {}),
        ...(candidate.emails ? { emails: candidate.emails.map(restore) } : {}),
      });
    }
    const restored = ScanResult.safeParse({ candidates });
    if (!restored.success) {
      return { error: `A candidate was not valid: ${describeIssues(restored.error)}` };
    }
    return { result: { purpose: "scan", scan: restored.data } };
  }
}

export interface AgentOutcome {
  report: TaskReport;
  steps: number;
}

/**
 * Runs one agent task in the page it is given and decides what to tell the server. It never throws:
 * a model that is down, a browser that dies, or a budget that runs out each become a report.
 */
export async function runAgentTask(options: AgentRunOptions): Promise<AgentOutcome> {
  const run = new AgentRun(options);
  const report = await run.run();
  return { report, steps: run.stepCount };
}
