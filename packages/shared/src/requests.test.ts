import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ReplyClassification } from "./mail.js";
import { FormOutcome } from "./outcomes.js";
import {
  availableActions,
  canTransition,
  FORM_OUTCOMES,
  isActiveStatus,
  isTerminalStatus,
  nextStatuses,
  parseEventPayload,
  REPLY_OUTCOMES,
  REQUEST_EVENT_PAYLOADS,
  RequestActor,
  RequestEvent,
  RequestEventType,
  RequestStatus,
  requestEventSchema,
  resendEmailKind,
} from "./requests.js";

const system = { actor: "system" } as const;
const user = { actor: "user" } as const;

describe("request status machine", () => {
  it("follows the happy path", () => {
    expect(canTransition("draft", "queued", system)).toBe(true);
    expect(canTransition("queued", "sent", system)).toBe(true);
    expect(canTransition("sent", "awaiting_reply", system)).toBe(true);
    expect(canTransition("awaiting_reply", "confirmed", system)).toBe(true);
  });

  it("re-queues bounces and follow-ups", () => {
    expect(canTransition("sent", "bounced", system)).toBe(true);
    expect(canTransition("bounced", "queued", system)).toBe(true);
    expect(canTransition("awaiting_reply", "no_response", system)).toBe(true);
    expect(canTransition("no_response", "follow_up_due", system)).toBe(true);
    expect(canTransition("follow_up_due", "queued", system)).toBe(true);
  });

  it("lets a request switch channel while awaiting a reply", () => {
    expect(canTransition("awaiting_reply", "queued", system)).toBe(true);
  });

  it("hands verification to a human and sends the approved reply through the queue", () => {
    expect(canTransition("awaiting_reply", "needs_verification", system)).toBe(true);
    expect(canTransition("needs_verification", "queued", system)).toBe(true);
    expect(canTransition("needs_verification", "sent", system)).toBe(false);
  });

  it("allows appealing a rejection", () => {
    expect(canTransition("rejected", "queued", system)).toBe(true);
  });

  it("rejects skipping steps", () => {
    expect(canTransition("draft", "confirmed", system)).toBe(false);
    expect(canTransition("draft", "sent", system)).toBe(false);
    expect(canTransition("awaiting_reply", "sent", system)).toBe(false);
    expect(canTransition("confirmed", "queued", system)).toBe(false);
  });

  it("never lets a non-user actor answer a request that was never sent or revive a closed one", () => {
    for (const actor of ["system", "worker", "agent"] as const) {
      expect(canTransition("draft", "awaiting_reply", { actor })).toBe(false);
      expect(canTransition("draft", "no_record", { actor })).toBe(false);
      expect(canTransition("rejected", "awaiting_reply", { actor })).toBe(false);
      expect(canTransition("bounced", "confirmed", { actor })).toBe(false);
      expect(canTransition("no_record", "queued", { actor })).toBe(false);
    }
  });

  it("closes a request from a late reply, whichever waiting status it is in", () => {
    for (const from of ["no_response", "follow_up_due", "needs_verification"] as const) {
      for (const to of [
        "confirmed",
        "no_record",
        "rejected",
        "bounced",
        "awaiting_reply",
        "queued",
      ] as const) {
        expect(canTransition(from, to, system), `${from} -> ${to}`).toBe(true);
      }
    }
    expect(canTransition("no_response", "needs_verification", system)).toBe(true);
    expect(canTransition("follow_up_due", "needs_verification", system)).toBe(true);
    expect(canTransition("rejected", "confirmed", system)).toBe(true);
    expect(canTransition("rejected", "no_record", system)).toBe(true);
  });

  it("lets a form result close a queued request without pretending it was sent", () => {
    for (const to of [
      "awaiting_reply",
      "confirmed",
      "no_record",
      "rejected",
      "needs_verification",
    ] as const) {
      expect(canTransition("queued", to, system), to).toBe(true);
    }
  });

  it("lets a reply that arrives while a request is still marked sent be applied", () => {
    for (const to of [
      "confirmed",
      "rejected",
      "needs_verification",
      "no_record",
      "queued",
    ] as const) {
      expect(canTransition("sent", to, system), to).toBe(true);
    }
  });

  it("lets a user force a closed outcome from any non-terminal status", () => {
    const outcomes = ["confirmed", "no_record", "rejected", "cancelled"] as const;
    for (const from of RequestStatus.options) {
      if (isTerminalStatus(from)) continue;
      for (const to of outcomes) {
        expect(canTransition(from, to, user), `${from} -> ${to}`).toBe(from !== to);
      }
    }
  });

  it("does not let a user force anything but a closed outcome", () => {
    expect(canTransition("draft", "sent", user)).toBe(false);
    expect(canTransition("draft", "awaiting_reply", user)).toBe(false);
    expect(canTransition("bounced", "awaiting_reply", user)).toBe(false);
    expect(canTransition("rejected", "awaiting_reply", user)).toBe(false);
  });

  it("never leaves a terminal state, for any actor", () => {
    for (const actor of RequestActor.options) {
      for (const status of RequestStatus.options.filter(isTerminalStatus)) {
        expect(nextStatuses(status, { actor })).toEqual([]);
      }
    }
  });

  it("never transitions to itself", () => {
    for (const actor of RequestActor.options) {
      for (const status of RequestStatus.options) {
        expect(canTransition(status, status, { actor })).toBe(false);
      }
    }
  });

  it("lets every non-terminal state be cancelled", () => {
    for (const status of RequestStatus.options) {
      if (isTerminalStatus(status)) continue;
      expect(canTransition(status, "cancelled", system)).toBe(true);
    }
  });
});

describe("nextStatuses", () => {
  it("lists what an actor may move to", () => {
    const fromSent = [
      "queued",
      "awaiting_reply",
      "confirmed",
      "rejected",
      "needs_verification",
      "no_record",
      "bounced",
      "cancelled",
    ];
    expect(nextStatuses("sent", system)).toEqual(fromSent);
    expect(nextStatuses("sent", user)).toEqual(fromSent);
    expect(nextStatuses("bounced", system)).toEqual(["queued", "cancelled"]);
  });
});

/**
 * Statuses a reply can arrive in. A draft has sent nothing and a bounced request has no live
 * channel, so a reply to either is only recorded.
 */
const REPLY_STATUSES = [
  "queued",
  "sent",
  "awaiting_reply",
  "needs_verification",
  "rejected",
  "no_response",
  "follow_up_due",
] as const;

describe("applying a classified reply", () => {
  it("moves a request wherever the machine allows, and the exceptions are the ones that make sense", () => {
    const recordedOnly: string[] = [];
    for (const classification of ReplyClassification.options) {
      const target = REPLY_OUTCOMES[classification];
      if (target === null) continue;
      for (const status of REPLY_STATUSES) {
        if (target === status || canTransition(status, target, system)) continue;
        recordedOnly.push(`${status} <- ${classification}`);
      }
    }
    // A bounce or a verification demand on a rejected request is recorded on the timeline and
    // leaves the status alone.
    expect(recordedOnly.sort()).toEqual(
      ["rejected <- bounce", "rejected <- verification_required"].sort(),
    );
  });

  it("names a status or nothing for every classification", () => {
    expect(Object.keys(REPLY_OUTCOMES).sort()).toEqual([...ReplyClassification.options].sort());
    for (const target of Object.values(REPLY_OUTCOMES)) {
      if (target !== null) expect(RequestStatus.options).toContain(target);
    }
  });

  it("changes nothing for mail that is not an answer", () => {
    for (const classification of [
      "auto_ack",
      "confirmation_link",
      "unrelated",
      "unknown",
    ] as const) {
      expect(REPLY_OUTCOMES[classification]).toBeNull();
    }
  });
});

describe("applying a form result", () => {
  it("is allowed from queued for every outcome, where a form run happens", () => {
    for (const outcome of FormOutcome.options) {
      expect(canTransition("queued", FORM_OUTCOMES[outcome], system), outcome).toBe(true);
    }
  });

  it("closes the request when there is no record to remove, and waits for the broker otherwise", () => {
    expect(FORM_OUTCOMES).toEqual({
      submitted: "awaiting_reply",
      awaiting_email_confirmation: "awaiting_reply",
      not_found: "no_record",
      already_removed: "no_record",
    });
  });
});

describe("availableActions", () => {
  const actions = (status: RequestStatus, hasLiveTask = false) =>
    availableActions({ status }, { hasLiveTask });

  it("offers every action that the state machine and the resend rule allow", () => {
    expect(actions("awaiting_reply")).toEqual([
      "cancel",
      "resend",
      "mark_confirmed",
      "mark_rejected",
      "mark_no_record",
    ]);
    expect(actions("rejected")).toEqual(["cancel", "resend", "mark_confirmed", "mark_no_record"]);
    expect(actions("bounced")).toContain("resend");
    expect(actions("no_response")).toContain("resend");
    expect(actions("follow_up_due")).toContain("resend");
  });

  it("does not offer a resend from sent or needs_verification, or from a draft", () => {
    for (const status of ["sent", "needs_verification", "draft"] as const) {
      expect(actions(status), status).not.toContain("resend");
    }
  });

  it("offers a resend from queued only when nothing is live to send it", () => {
    expect(actions("queued", true)).not.toContain("resend");
    expect(actions("queued", false)).toContain("resend");
  });

  it("offers nothing on a closed request", () => {
    for (const status of ["confirmed", "no_record", "cancelled"] as const) {
      expect(actions(status), status).toEqual([]);
    }
  });

  it("never offers an action the machine refuses a user", () => {
    for (const status of RequestStatus.options) {
      const offered = actions(status);
      if (offered.includes("mark_confirmed")) {
        expect(canTransition(status, "confirmed", user)).toBe(true);
      }
      if (offered.includes("cancel")) expect(canTransition(status, "cancelled", user)).toBe(true);
      if (offered.includes("resend")) {
        expect(canTransition(status, "queued", system) || status === "queued", status).toBe(true);
      }
    }
  });
});

describe("resendEmailKind", () => {
  it("nudges a request that went unanswered and starts a rejected or bounced one over", () => {
    for (const status of ["awaiting_reply", "no_response", "follow_up_due"] as const) {
      expect(resendEmailKind(status)).toBe("follow_up");
    }
    for (const status of ["rejected", "bounced", "queued"] as const) {
      expect(resendEmailKind(status)).toBe("initial");
    }
  });
});

describe("request events", () => {
  const base = {
    id: "e1",
    requestId: "r1",
    actor: "system" as const,
    createdAt: "2026-10-07T00:00:00.000Z",
  };

  it("has a payload schema for every event type and no extra", () => {
    expect(Object.keys(REQUEST_EVENT_PAYLOADS).sort()).toEqual(
      [...RequestEventType.options].sort(),
    );
  });

  it("types the payload by the event", () => {
    expect(
      RequestEvent.parse({
        ...base,
        type: "status_changed",
        payload: { from: "queued", to: "sent" },
      }),
    ).toMatchObject({ type: "status_changed" });
    expect(
      RequestEvent.safeParse({ ...base, type: "status_changed", payload: { from: "queued" } })
        .success,
    ).toBe(false);
    expect(RequestEvent.safeParse({ ...base, type: "note", payload: {} }).success).toBe(false);
    expect(RequestEvent.safeParse({ ...base, type: "nope", payload: {} }).success).toBe(false);
  });

  it("accepts the shapes the modules write", () => {
    const examples: Record<string, unknown> = {
      created: { channel: "email", rights: ["opt_out"], reference: "KR-ABC234" },
      queued: { channel: "email", reason: "new" },
      sent: {
        channel: "email",
        kind: "initial",
        messageId: "<kr.r1.0@example.test>",
        mailboxId: "m1",
      },
      send_failed: { error: "535 bad credentials", willRetry: false },
      reply_received: { messageId: "m2", from: "privacy@broker.test", subject: "Re: KR-ABC234" },
      classified: {
        messageId: "m2",
        classification: "completed",
        confidence: 0.9,
        correlation: "message_id",
      },
      link_followed: {
        url: "https://broker.test/c?t=1",
        finalUrl: "https://broker.test/ok",
        ok: true,
      },
      status_changed: { from: "awaiting_reply", to: "confirmed" },
      follow_up_sent: { messageId: "<kr.r1.1@example.test>", number: 1 },
      channel_switched: { from: "email", to: "form", reason: "bounce" },
      awaiting_confirmation: { fromDomains: ["broker.test"], linkTextPattern: null },
      task_enqueued: { taskId: "t1", kind: "form" },
      task_blocked: { taskId: "t1", kind: "form", reason: "captcha", detail: null },
      task_completed: { taskId: "t1", kind: "form", outcome: "submitted", note: null },
      task_failed: { taskId: "t1", kind: "form", error: "selector missing", failureKind: "recipe" },
      task_cancelled: { taskId: "t1", kind: "form" },
      task_resumed: { taskId: "t1", kind: "form" },
      task_retrying: { taskId: "t1", kind: "email_send", error: "timeout", attempt: 2 },
      user_action: { action: "mark_confirmed", note: null },
      relisted: { recordUrl: "https://broker.test/p/1", previousStatus: "confirmed" },
      note: { text: "Called, they said it is done." },
    };
    expect(Object.keys(examples).sort()).toEqual([...RequestEventType.options].sort());
    for (const [type, payload] of Object.entries(examples)) {
      expect(RequestEvent.safeParse({ ...base, type, payload }).success, type).toBe(true);
    }
  });

  it("validates a payload before it is written", () => {
    expect(parseEventPayload("note", { text: "x" })).toEqual({ text: "x" });
    expect(() => parseEventPayload("note", { body: "x" })).toThrow();
    expect(() => parseEventPayload("task_enqueued", { taskId: "t1", kind: "nope" })).toThrow();
  });

  it("lets a view add fields to every variant", () => {
    const withTarget = requestEventSchema({ targetName: z.string() });
    expect(
      withTarget.parse({ ...base, type: "note", payload: { text: "x" }, targetName: "Spokeo" }),
    ).toMatchObject({ targetName: "Spokeo" });
  });
});

describe("isActiveStatus", () => {
  it("treats closed outcomes as inactive", () => {
    for (const status of ["confirmed", "no_record", "cancelled", "rejected"] as const) {
      expect(isActiveStatus(status)).toBe(false);
    }
    for (const status of [
      "draft",
      "queued",
      "sent",
      "awaiting_reply",
      "needs_verification",
      "bounced",
      "no_response",
      "follow_up_due",
    ] as const) {
      expect(isActiveStatus(status)).toBe(true);
    }
  });
});
