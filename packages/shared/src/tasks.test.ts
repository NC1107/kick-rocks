import { describe, expect, it } from "vitest";
import {
  AgentResult,
  BROWSER_TASK_KINDS,
  ClaimedTask,
  FormResult,
  IN_PROCESS_TASK_KINDS,
  LIVE_TASK_STATUSES,
  manualResultSchemaFor,
  parseTaskPayload,
  parseTaskResult,
  resultSchemaFor,
  ScanResult,
  TASK_PAYLOAD_SCHEMAS,
  TASK_RESULT_SCHEMAS,
  TaskBlockReport,
  TaskFailureReport,
  TaskKind,
  TaskMarkDoneBody,
  TaskScreenshot,
  TaskSummary,
  TaskUsage,
  toTaskResult,
} from "./tasks.js";

describe("task kinds", () => {
  it("drops human_review and adds canary", () => {
    expect(TaskKind.options).toEqual([
      "email_send",
      "inbox_poll",
      "scan",
      "form",
      "confirm",
      "canary",
      "agent",
    ]);
  });

  it("splits kinds between the server and the browser without overlap", () => {
    expect([...IN_PROCESS_TASK_KINDS]).toEqual(["email_send", "inbox_poll"]);
    expect([...BROWSER_TASK_KINDS]).toEqual(["scan", "form", "confirm", "canary", "agent"]);
    expect([...IN_PROCESS_TASK_KINDS, ...BROWSER_TASK_KINDS].sort()).toEqual(
      [...TaskKind.options].sort(),
    );
  });

  it("keeps a blocked task live so its dedupe key stays taken", () => {
    expect([...LIVE_TASK_STATUSES]).toEqual(["queued", "leased", "blocked"]);
  });

  it("has a payload and result schema for every kind", () => {
    for (const kind of TaskKind.options) {
      expect(TASK_PAYLOAD_SCHEMAS[kind]).toBeDefined();
      expect(TASK_RESULT_SCHEMAS[kind]).toBeDefined();
    }
  });
});

describe("task payloads", () => {
  it("accepts the documented shape of each kind", () => {
    expect(
      parseTaskPayload("email_send", { requestId: "r1", kind: "initial", inReplyTo: null }),
    ).toEqual({ requestId: "r1", kind: "initial", fields: [], inReplyTo: null });
    expect(parseTaskPayload("inbox_poll", { mailboxId: "m1" })).toEqual({ mailboxId: "m1" });
    expect(
      parseTaskPayload("scan", { profileId: "p", targetId: "t", recipeId: null, variant: null })
        .recipeId,
    ).toBeNull();
    expect(
      parseTaskPayload("form", {
        requestId: "r",
        targetId: "t",
        recipeId: "x.remove.v1",
        recordUrl: "https://x.test/p/1",
      }).recordUrl,
    ).toBe("https://x.test/p/1");
    expect(
      parseTaskPayload("confirm", { requestId: "r", url: "https://x.test/confirm?t=1" }).url,
    ).toContain("confirm");
    expect(parseTaskPayload("canary", { recipeId: "x.scan.v1" })).toEqual({
      recipeId: "x.scan.v1",
    });
    expect(
      parseTaskPayload("agent", {
        purpose: "remove",
        profileId: "p",
        targetId: "t",
        requestId: "r",
        recordUrl: null,
        variant: null,
        reason: "recipe_failed",
        previousError: "selector missing",
        blockedReason: null,
      }).reason,
    ).toBe("recipe_failed");
  });

  it("reads an agent task stored before it carried rights as asking for none", () => {
    const stored = {
      purpose: "remove",
      profileId: "p",
      targetId: "t",
      requestId: "r",
      recordUrl: null,
      variant: null,
      reason: "no_recipe",
      previousError: null,
      blockedReason: null,
    };
    expect(parseTaskPayload("agent", stored).rights).toEqual([]);
    expect(parseTaskPayload("agent", { ...stored, rights: ["delete"] }).rights).toEqual(["delete"]);
    expect(() => parseTaskPayload("agent", { ...stored, rights: ["sell"] })).toThrow();
  });

  it("says why an agent has the work, including a human check that stopped the worker", () => {
    const agent = {
      purpose: "scan",
      profileId: "p",
      targetId: "t",
      requestId: null,
      recordUrl: null,
      variant: null,
      reason: "blocked",
      previousError: null,
      blockedReason: "captcha",
    };
    expect(parseTaskPayload("agent", agent)).toMatchObject({
      reason: "blocked",
      blockedReason: "captcha",
    });
    expect(() => parseTaskPayload("agent", { ...agent, reason: "bored" })).toThrow();
    expect(() => parseTaskPayload("agent", { ...agent, blockedReason: "recipe_failed" })).toThrow();
  });

  it("names the kind of email and the fields a verification reply sends", () => {
    const base = { requestId: "r", inReplyTo: "<broker@example.test>" };
    expect(
      parseTaskPayload("email_send", {
        ...base,
        kind: "verification_reply",
        fields: ["date_of_birth"],
      }),
    ).toMatchObject({ kind: "verification_reply", fields: ["date_of_birth"] });
    expect(() => parseTaskPayload("email_send", { ...base, kind: "verification_reply" })).toThrow(
      /names the approved fields/,
    );
    expect(() =>
      parseTaskPayload("email_send", { ...base, kind: "follow_up", fields: ["street"] }),
    ).toThrow();
    expect(() => parseTaskPayload("email_send", { requestId: "r", followUp: false })).toThrow();
    expect(() =>
      parseTaskPayload("email_send", { ...base, kind: "verification_reply", fields: ["ssn"] }),
    ).toThrow();
  });

  it("lets a scan search under a past name or address", () => {
    const scan = { profileId: "p", targetId: "t", recipeId: null };
    expect(
      parseTaskPayload("scan", { ...scan, variant: { nameId: "alias1", addressId: null } }).variant,
    ).toEqual({ nameId: "alias1", addressId: null });
    expect(() => parseTaskPayload("scan", scan)).toThrow();
  });

  it("rejects missing fields, unknown reasons, and non-web urls", () => {
    expect(() => parseTaskPayload("email_send", { requestId: "r" })).toThrow();
    expect(() =>
      parseTaskPayload("confirm", { requestId: "r", url: "javascript:alert(1)" }),
    ).toThrow();
    expect(() =>
      parseTaskPayload("agent", {
        purpose: "scan",
        profileId: "p",
        targetId: "t",
        requestId: null,
        recordUrl: null,
        variant: null,
        reason: "because",
        previousError: null,
        blockedReason: null,
      }),
    ).toThrow();
  });

  it("carries ids only, so no field for personal data exists to be filled", () => {
    const keys = Object.values(TASK_PAYLOAD_SCHEMAS).flatMap((schema) => Object.keys(schema.shape));
    for (const forbidden of ["email", "name", "phone", "address", "dob", "firstName", "lastName"]) {
      expect(keys).not.toContain(forbidden);
    }
    // The verification reply names fields, never values, and the scan variant names identities by id.
    expect(keys).toContain("fields");
    expect(keys).toContain("variant");
  });
});

describe("task results", () => {
  const candidate = {
    recordUrl: "https://x.test/p/1",
    name: "Jordan Example",
    locations: ["Austin, TX"],
  };

  it("accepts scan candidates with optional detail", () => {
    expect(ScanResult.safeParse({ candidates: [candidate] }).success).toBe(true);
    expect(
      ScanResult.safeParse({
        candidates: [
          {
            ...candidate,
            age: 36,
            relatives: ["A"],
            phones: ["+15555550123"],
            emails: ["a@example.com"],
          },
        ],
      }).success,
    ).toBe(true);
    expect(
      ScanResult.safeParse({ candidates: [{ ...candidate, recordUrl: "relative/path" }] }).success,
    ).toBe(false);
  });

  it("accepts each form outcome and nothing else", () => {
    for (const outcome of [
      "submitted",
      "not_found",
      "already_removed",
      "awaiting_email_confirmation",
    ]) {
      expect(parseTaskResult("form", { outcome })).toEqual({ outcome });
    }
    expect(() => parseTaskResult("form", { outcome: "done" })).toThrow();
  });

  it("validates confirm and canary results", () => {
    expect(
      parseTaskResult("confirm", { confirmed: true, finalUrl: "https://x.test/ok" }).confirmed,
    ).toBe(true);
    expect(
      parseTaskResult("canary", { healthy: false, missingSelectors: ["form.search"] })
        .missingSelectors,
    ).toHaveLength(1);
    expect(() => parseTaskResult("canary", { healthy: true })).toThrow();
  });

  it("discriminates agent results by purpose", () => {
    expect(AgentResult.safeParse({ purpose: "scan", scan: { candidates: [] } }).success).toBe(true);
    expect(
      AgentResult.safeParse({ purpose: "remove", form: { outcome: "submitted" } }).success,
    ).toBe(true);
    expect(AgentResult.safeParse({ purpose: "scan", form: { outcome: "submitted" } }).success).toBe(
      false,
    );
    expect(AgentResult.safeParse({ purpose: "remove", scan: { candidates: [] } }).success).toBe(
      false,
    );
  });

  it("lets in-process tasks report any JSON object", () => {
    expect(
      parseTaskResult("email_send", {
        messageId: "<x@example.com>",
        sentAt: "2026-10-07T00:00:00.000Z",
      }),
    ).toBeTruthy();
    expect(() => parseTaskResult("inbox_poll", "done")).toThrow();
  });
});

describe("ClaimedTask", () => {
  const target = {
    id: "spokeo",
    kind: "broker",
    name: "Spokeo",
    category: "people-search",
    domain: "spokeo.com",
    website: null,
    optOutUrl: "https://www.spokeo.com/optout",
    privacyRightsUrl: null,
    searchUrl: null,
    contactMethod: "form",
    requiresId: false,
    requirements: ["record_url"],
    priority: "crucial",
    needsRecord: true,
    californiaRegistered: false,
    retired: false,
  };
  const base = {
    id: "t1",
    attempt: 1,
    leaseExpiresAt: "2026-10-07T01:00:00.000Z",
    target,
    recipe: null,
    fields: { first_name: "Jordan" },
    instructions: "Do the thing.",
  };

  it("narrows the payload by kind", () => {
    const task = ClaimedTask.parse({
      ...base,
      kind: "confirm",
      payload: { requestId: "r", url: "https://x.test/c" },
    });
    expect(task.kind).toBe("confirm");
  });

  it("rejects an in-process kind and a mismatched payload", () => {
    expect(
      ClaimedTask.safeParse({
        ...base,
        kind: "email_send",
        payload: { requestId: "r", followUp: false },
      }).success,
    ).toBe(false);
    expect(
      ClaimedTask.safeParse({
        ...base,
        kind: "scan",
        payload: { requestId: "r", url: "https://x.test" },
      }).success,
    ).toBe(false);
  });

  it("rejects fields that are not profile fields", () => {
    expect(
      ClaimedTask.safeParse({
        ...base,
        fields: { ssn: "123" },
        kind: "canary",
        payload: { recipeId: "x.scan.v1" },
      }).success,
    ).toBe(false);
  });
});

describe("block and failure reports", () => {
  it("accepts a block with a screenshot", () => {
    expect(
      TaskBlockReport.safeParse({
        reason: "captcha",
        detail: "reCAPTCHA",
        screenshot: { mime: "image/png", dataBase64: "iVBORw0KGgo=" },
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown reason, a non-image, and an oversized screenshot", () => {
    expect(TaskBlockReport.safeParse({ reason: "boredom" }).success).toBe(false);
    expect(TaskScreenshot.safeParse({ mime: "text/html", dataBase64: "aa" }).success).toBe(false);
    expect(
      TaskScreenshot.safeParse({ mime: "image/png", dataBase64: "a".repeat(12 * 1024 * 1024) })
        .success,
    ).toBe(false);
  });

  it("requires an error message on failure", () => {
    expect(
      TaskFailureReport.safeParse({ error: "boom", retryable: true, retryAfterMs: 1000 }).success,
    ).toBe(true);
    expect(TaskFailureReport.safeParse({ error: "", retryable: true }).success).toBe(false);
    expect(TaskFailureReport.safeParse({ error: "x" }).success).toBe(false);
  });
});

describe("failure reports", () => {
  it("says what broke, defaulting to an internal error", () => {
    expect(TaskFailureReport.parse({ error: "x", retryable: false }).kind).toBe("internal");
    expect(
      TaskFailureReport.parse({ error: "x", retryable: false, kind: "recipe", step: 3 }),
    ).toMatchObject({ kind: "recipe", step: 3 });
    expect(TaskFailureReport.safeParse({ error: "x", retryable: false, kind: "bug" }).success).toBe(
      false,
    );
    expect(TaskFailureReport.safeParse({ error: "x", retryable: false, step: -1 }).success).toBe(
      false,
    );
  });

  it("carries usage on a failure, a block, and a hand-by-hand finish", () => {
    const usage = { inputTokens: 1200, outputTokens: 300, costUsd: 0.02, durationMs: 41000 };
    expect(TaskFailureReport.parse({ error: "x", retryable: true, usage }).usage).toEqual(usage);
    expect(TaskBlockReport.parse({ reason: "captcha", usage }).usage).toEqual(usage);
    expect(TaskUsage.safeParse({ inputTokens: -1 }).success).toBe(false);
  });

  it("names the page where a worker got stuck, as a web url", () => {
    expect(
      TaskBlockReport.safeParse({ reason: "captcha", url: "https://x.test/optout?step=2" }).success,
    ).toBe(true);
    expect(
      TaskBlockReport.safeParse({ reason: "captcha", url: "javascript:alert(1)" }).success,
    ).toBe(false);
  });

  it("no longer has recipe_failed among the reasons a run stops for a human", () => {
    expect(TaskBlockReport.safeParse({ reason: "recipe_failed" }).success).toBe(false);
  });
});

describe("what a task result must look like", () => {
  const agentScan = { kind: "agent" as const, payload: { purpose: "scan" } };
  const agentRemove = { kind: "agent" as const, payload: { purpose: "remove" } };
  const scanResult = { purpose: "scan", scan: { candidates: [] } };
  const removeResult = { purpose: "remove", form: { outcome: "submitted" } };

  it("follows the purpose of an agent task, not what the caller claims", () => {
    expect(resultSchemaFor(agentScan).safeParse(scanResult).success).toBe(true);
    expect(resultSchemaFor(agentScan).safeParse(removeResult).success).toBe(false);
    expect(resultSchemaFor(agentRemove).safeParse(removeResult).success).toBe(true);
    expect(resultSchemaFor(agentRemove).safeParse(scanResult).success).toBe(false);
  });

  it("is the kind's own schema for every other task", () => {
    expect(resultSchemaFor({ kind: "form", payload: {} })).toBe(FormResult);
    expect(resultSchemaFor({ kind: "scan", payload: {} })).toBe(ScanResult);
  });

  it("lets a person give the plain result, which an agent task wraps", () => {
    expect(manualResultSchemaFor(agentScan)).toBe(ScanResult);
    expect(manualResultSchemaFor(agentRemove)).toBe(FormResult);
    expect(manualResultSchemaFor({ kind: "form", payload: {} })).toBe(FormResult);
    const form = { outcome: "already_removed" };
    expect(toTaskResult(agentRemove, form)).toEqual({ purpose: "remove", form });
    expect(toTaskResult(agentScan, { candidates: [] })).toEqual(scanResult);
    expect(toTaskResult({ kind: "form", payload: {} }, form)).toBe(form);
    expect(AgentResult.safeParse(toTaskResult(agentRemove, form)).success).toBe(true);
  });

  it("reports where a confirmation email will come from, as a host and never an address", () => {
    expect(
      FormResult.safeParse({
        outcome: "awaiting_email_confirmation",
        confirmationFrom: "peopleconnect.us",
      }).success,
    ).toBe(true);
    expect(
      FormResult.safeParse({ outcome: "submitted", confirmationFrom: "noreply@peopleconnect.us" })
        .success,
    ).toBe(false);
  });
});

describe("finishing a blocked task by hand", () => {
  it("takes an optional result and a bounded note", () => {
    expect(TaskMarkDoneBody.safeParse({}).success).toBe(true);
    expect(
      TaskMarkDoneBody.safeParse({ result: { outcome: "submitted" }, note: "By hand." }).success,
    ).toBe(true);
    expect(TaskMarkDoneBody.safeParse({ note: "x".repeat(2001) }).success).toBe(false);
  });
});

describe("TaskSummary", () => {
  it("carries who finished it, what it cost, and what broke", () => {
    const summary = {
      id: "t",
      kind: "form",
      status: "failed",
      priority: 20,
      profileId: "p",
      targetId: "x",
      targetName: "X",
      requestId: "r",
      blockedReason: null,
      blockedDetail: null,
      blockedUrl: null,
      attempts: 1,
      maxAttempts: 3,
      lastError: "selector missing",
      failureKind: "recipe",
      failureStep: 4,
      hasScreenshot: false,
      finishedBy: "home-worker",
      claimerKind: "builtin",
      usage: { durationMs: 1200 },
      createdAt: "2026-10-07T00:00:00.000Z",
      updatedAt: "2026-10-07T00:00:00.000Z",
    };
    expect(TaskSummary.parse(summary)).toEqual(summary);
    expect(TaskSummary.safeParse({ ...summary, claimerKind: "robot" }).success).toBe(false);
  });
});
