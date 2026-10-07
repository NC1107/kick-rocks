import { RequestEvent, RequestEventType } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { describeEvent } from "./events.js";

const base = {
  id: "e1",
  requestId: "r1",
  actor: "system" as const,
  createdAt: "2026-10-07T00:00:00.000Z",
};

const PAYLOADS: Record<RequestEventType, unknown> = {
  created: { channel: "email", rights: ["opt_out", "delete"], reference: "KR-ABC234" },
  queued: { channel: "email", reason: "new" },
  sent: { channel: "email", kind: "initial", messageId: "<kr.r1.0@example.test>", mailboxId: "m1" },
  send_failed: { error: "535 bad credentials", willRetry: false },
  reply_received: { messageId: "m2", from: "privacy@broker.test", subject: "Re: KR-ABC234" },
  classified: {
    messageId: "m2",
    classification: "completed",
    confidence: 0.93,
    correlation: "reference",
  },
  link_followed: { url: "https://broker.test/c?t=1", finalUrl: "https://broker.test/ok", ok: true },
  status_changed: { from: "awaiting_reply", to: "confirmed" },
  follow_up_sent: { messageId: null, number: 2 },
  channel_switched: { from: "email", to: "form", reason: "bounce" },
  awaiting_confirmation: { fromDomains: ["broker.test"], linkTextPattern: null },
  task_enqueued: { taskId: "t1", kind: "form" },
  task_blocked: { taskId: "t1", kind: "form", reason: "captcha", detail: null },
  task_completed: { taskId: "t1", kind: "form", outcome: "not_found", note: null },
  task_failed: { taskId: "t1", kind: "form", error: "selector missing", failureKind: "recipe" },
  task_cancelled: { taskId: "t1", kind: "form" },
  task_resumed: { taskId: "t1", kind: "form" },
  task_retrying: { taskId: "t1", kind: "email_send", error: "timeout", attempt: 2 },
  user_action: { action: "mark_confirmed", note: null },
  relisted: { recordUrl: "https://broker.test/p/1", previousStatus: "confirmed" },
  note: { text: "Called, they said it is done." },
};

const event = (type: RequestEventType, payload: unknown = PAYLOADS[type]) =>
  RequestEvent.parse({ ...base, type, payload });

describe("describeEvent", () => {
  it("has a sentence for every event type", () => {
    for (const type of RequestEventType.options) {
      const text = describeEvent(event(type));
      expect(text.length, type).toBeGreaterThan(8);
      expect(text, type).toMatch(/[.]$|[A-Za-z]$/);
    }
  });

  it("never uses an em dash or an exclamation mark, whatever the payload carries", () => {
    const EM_DASH = String.fromCodePoint(0x2014);
    for (const type of RequestEventType.options) {
      const text = describeEvent(event(type));
      expect(text, type).not.toContain(EM_DASH);
      expect(text, type).not.toContain("!");
    }
  });

  it("says what changed, in the words the status pills use", () => {
    expect(describeEvent(event("status_changed"))).toBe(
      "Status changed from Awaiting reply to Confirmed.",
    );
  });

  it("tells an email from a form, and a follow-up from a first send", () => {
    expect(describeEvent(event("sent"))).toBe("Sent the email.");
    expect(
      describeEvent(
        event("sent", { channel: "form", kind: "initial", messageId: null, mailboxId: null }),
      ),
    ).toBe("Submitted the web form.");
    expect(
      describeEvent(
        event("sent", { channel: "email", kind: "follow_up", messageId: "<a@b>", mailboxId: "m" }),
      ),
    ).toBe("Sent the follow-up.");
    expect(
      describeEvent(
        event("sent", {
          channel: "email",
          kind: "verification_reply",
          messageId: "<a@b>",
          mailboxId: "m",
        }),
      ),
    ).toBe("Sent the verification reply.");
  });

  it("says why a request was queued again", () => {
    expect(
      describeEvent(event("queued", { channel: "email", reason: "verification_reply" })),
    ).toMatch(/details the broker asked for/);
  });

  it("explains a block, a failure, and a finish with what the person needs", () => {
    expect(describeEvent(event("task_blocked"))).toBe(
      "The submit form task stopped for you: captcha.",
    );
    expect(describeEvent(event("task_failed"))).toContain(
      "The saved steps no longer match the page.",
    );
    expect(describeEvent(event("task_completed"))).toBe(
      "The submit form task finished (not found).",
    );
    expect(
      describeEvent(
        event("task_completed", {
          taskId: "t",
          kind: "form",
          outcome: null,
          note: "Did it by hand",
        }),
      ),
    ).toBe("The submit form task finished. You noted: Did it by hand");
  });

  it("names the sender a confirmation email is expected from", () => {
    expect(describeEvent(event("awaiting_confirmation"))).toBe(
      "Waiting for the confirmation email from broker.test.",
    );
    expect(
      describeEvent(event("awaiting_confirmation", { fromDomains: [], linkTextPattern: null })),
    ).toBe("Waiting for the confirmation email.");
  });

  it("reads a person's own actions as something they chose", () => {
    expect(describeEvent(event("user_action"))).toBe("You chose to mark it as confirmed.");
    expect(describeEvent(event("user_action", { action: "verification_reply", note: null }))).toBe(
      "You chose to approve sending the details the broker asked for.",
    );
  });

  it("shows a note as the person wrote it", () => {
    expect(describeEvent(event("note"))).toBe("Called, they said it is done.");
  });
});
