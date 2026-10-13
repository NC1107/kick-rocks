import type { RequestDetail } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { formatShortDate } from "../../lib/format.js";
import { nextStep, statusPhrase } from "./phrase.js";

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
      text: "Waiting on them",
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
    ).toBe("Scheduled");
  });

  it("does not claim a retry when the failure will not be retried", () => {
    expect(
      statusPhrase(request("queued", sendFailed(false, "2026-10-13T10:00:00.000Z"))).text,
    ).toBe("Scheduled");
  });
});

describe("claimed and verified removals", () => {
  const verifiedGone = {
    id: "v",
    type: "verified_gone",
    createdAt: "2026-10-09T10:00:00.000Z",
    actor: "system",
    payload: { recordUrl: null, scanId: "s1" },
  };

  it("says They said removed when only the company's word is in", () => {
    expect(statusPhrase(request("confirmed"))).toEqual({
      text: "They said removed",
      family: "resolved",
    });
    expect(statusPhrase(request("no_record")).text).toBe("They said removed");
  });

  it("says when a later scan checked it, from the timeline or from the list's date", () => {
    const expected = `Gone \u00b7 checked ${formatShortDate(verifiedGone.createdAt)}`;
    expect(statusPhrase(request("confirmed", verifiedGone)).text).toBe(expected);
    expect(
      statusPhrase({ status: "confirmed", verifiedGoneAt: verifiedGone.createdAt }).text,
    ).toBe(expected);
  });

  it("leaves other statuses alone", () => {
    expect(statusPhrase({ status: "sent", verifiedGoneAt: verifiedGone.createdAt }).text).toBe(
      "Sent",
    );
  });
});

describe("the next step on a request that waits on the person", () => {
  it("gives one short imperative for each status that needs a look", () => {
    expect(nextStep("no_response")).toBe("Send a follow-up");
    expect(nextStep("bounced")).toBe("Check the address");
    expect(nextStep("needs_verification")).toBe("Open and answer them");
    expect(nextStep("rejected")).toBe("Read their reply");
    expect(nextStep("follow_up_due")).toBe("Send a nudge");
  });

  it("gives nothing for a request that is only waiting or finished", () => {
    for (const status of ["draft", "queued", "sent", "awaiting_reply", "confirmed"] as const) {
      expect(nextStep(status), status).toBeNull();
    }
  });
});
