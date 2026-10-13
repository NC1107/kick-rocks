import type { RequestDetail } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { statusPhrase } from "./phrase.js";

const request = (status: RequestDetail["status"], ...events: unknown[]) =>
  ({ status, events }) as unknown as Pick<RequestDetail, "status" | "events">;

const sendFailed = (willRetry: boolean, createdAt: string) => ({
  id: createdAt,
  type: "send_failed",
  createdAt,
  actor: "system",
  payload: { error: "Could not connect to the mail server", willRetry },
});

describe("the status phrase on a request", () => {
  it("uses the status label when the timeline has nothing to contradict it", () => {
    expect(statusPhrase(request("awaiting_reply"))).toEqual({
      text: "Awaiting reply",
      family: "progress",
    });
  });

  it("says Will retry when a queued request's newest event is a send that will be tried again", () => {
    expect(statusPhrase(request("queued", sendFailed(true, "2026-10-13T10:00:00.000Z")))).toEqual({
      text: "Will retry",
      family: "needs",
    });
  });

  it("keeps Queued once a later event moves on", () => {
    const later = {
      id: "q",
      type: "queued",
      createdAt: "2026-10-13T10:05:00.000Z",
      actor: "system",
      payload: { reason: "retry" },
    };
    expect(
      statusPhrase(request("queued", sendFailed(true, "2026-10-13T10:00:00.000Z"), later)).text,
    ).toBe("Queued");
  });

  it("does not claim a retry when the failure will not be retried", () => {
    expect(
      statusPhrase(request("queued", sendFailed(false, "2026-10-13T10:00:00.000Z"))).text,
    ).toBe("Queued");
  });
});
