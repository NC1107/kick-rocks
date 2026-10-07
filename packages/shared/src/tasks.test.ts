import { describe, expect, it } from "vitest";
import {
  AgentResult,
  BROWSER_TASK_KINDS,
  ClaimedTask,
  IN_PROCESS_TASK_KINDS,
  LIVE_TASK_STATUSES,
  parseTaskPayload,
  parseTaskResult,
  ScanResult,
  TASK_PAYLOAD_SCHEMAS,
  TASK_RESULT_SCHEMAS,
  TaskBlockReport,
  TaskFailureReport,
  TaskKind,
  TaskScreenshot,
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
    expect(parseTaskPayload("email_send", { requestId: "r1", followUp: false })).toEqual({
      requestId: "r1",
      followUp: false,
    });
    expect(parseTaskPayload("inbox_poll", { mailboxId: "m1" })).toEqual({ mailboxId: "m1" });
    expect(
      parseTaskPayload("scan", { profileId: "p", targetId: "t", recipeId: null }).recipeId,
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
        reason: "recipe_failed",
        previousError: "selector missing",
      }).reason,
    ).toBe("recipe_failed");
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
        reason: "because",
        previousError: null,
      }),
    ).toThrow();
  });

  it("carries ids only, so no field for personal data exists to be filled", () => {
    const keys = Object.values(TASK_PAYLOAD_SCHEMAS).flatMap((schema) => Object.keys(schema.shape));
    for (const forbidden of ["email", "name", "phone", "address", "dob", "firstName", "lastName"]) {
      expect(keys).not.toContain(forbidden);
    }
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
    contactMethod: "form",
    requiresId: false,
    requirements: ["record_url"],
    priority: "crucial",
    needsRecord: true,
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
