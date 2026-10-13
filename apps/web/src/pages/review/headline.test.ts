import { type NeedsYouItem, NeedsYouKind } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { headlineFor, timeLeft } from "./headline.js";
import type { QueueEntry } from "./model.js";

const NOW = Date.parse("2026-10-13T12:00:00.000Z");
const later = (seconds: number) => new Date(NOW + seconds * 1000).toISOString();

function taskItem(kind: NeedsYouItem["kind"], expiresAt: string | null = null): NeedsYouItem {
  return {
    key: `task:${kind}`,
    kind,
    expiresAt,
    source: { task: { task: { targetName: "Cardinal Insights" } } },
  } as unknown as NeedsYouItem;
}

const record = {
  key: "match:1",
  kind: "record",
  source: { match: { targetName: "Spokeo", fields: { name: "Jordan Example" } } },
} as unknown as NeedsYouItem;

const details = {
  key: "details:1",
  kind: "details",
  source: { verification: { request: { target: { name: "Cardinal Insights" } } } },
} as unknown as NeedsYouItem;

const withTask = (kind: "failed" | "agents", lastError: string | null): QueueEntry =>
  ({
    kind,
    key: `${kind}:1`,
    item: {
      task: { targetName: "Cardinal Insights", lastError, failureKind: null },
    },
  }) as unknown as QueueEntry;

const mail = (requestId: string | null): QueueEntry =>
  ({
    kind: "mail",
    key: "mail:1",
    message: {
      requestId,
      fromAddress: "privacy@acme.example",
      targetName: requestId ? "Acme Data" : null,
    },
  }) as unknown as QueueEntry;

describe("headlineFor", () => {
  it("says what a pending send will do and when", () => {
    expect(headlineFor(taskItem("hold", later(7 * 60)), NOW)).toBe(
      "Sending a removal request to Cardinal Insights in 7 min unless you stop it.",
    );
  });

  it("counts down in seconds under a minute and rounds up so it never promises extra time", () => {
    expect(timeLeft(later(40), NOW)).toBe("40 sec");
    expect(timeLeft(later(61), NOW)).toBe("2 min");
    expect(timeLeft(later(-1), NOW)).toBeNull();
  });

  it("says a hold ran out instead of counting below zero", () => {
    expect(headlineFor(taskItem("hold", later(-5)), NOW)).toBe(
      "The hold on the request to Cardinal Insights ran out.",
    );
  });

  it("names the target and the decision for every other Needs you kind", () => {
    expect(headlineFor(taskItem("captcha"), NOW)).toBe(
      "Cardinal Insights wants a CAPTCHA solved before the removal can be sent.",
    );
    expect(headlineFor(taskItem("approve"), NOW)).toBe(
      "A request to Cardinal Insights paused before sending. Check what goes out, then approve it.",
    );
    expect(headlineFor(taskItem("check_sent"), NOW)).toBe(
      "Did the removal form on Cardinal Insights go through? Open the page to check.",
    );
    expect(headlineFor(taskItem("phone_code"), NOW)).toBe(
      "Cardinal Insights texted you a code. Enter it on their page to finish the removal.",
    );
    expect(headlineFor(taskItem("id"), NOW)).toBe(
      "Cardinal Insights asks for a photo ID before it will remove you. Share it only if you want to.",
    );
    expect(headlineFor(taskItem("email_link"), NOW)).toBe(
      "Cardinal Insights emailed you a link. Tap it to confirm the removal.",
    );
    expect(headlineFor(taskItem("login"), NOW)).toBe(
      "Cardinal Insights wants you signed in before the removal can be sent.",
    );
    expect(headlineFor(taskItem("bot"), NOW)).toBe(
      "Cardinal Insights blocked our browser. Finish the form in yours.",
    );
    expect(headlineFor(taskItem("by_hand"), NOW)).toBe(
      "Cardinal Insights can only be removed by hand. Open the page and finish the form.",
    );
    expect(headlineFor(record, NOW)).toBe("We found a listing on Spokeo. Is it you?");
    expect(headlineFor(details, NOW)).toBe(
      "Cardinal Insights wants more details before it will act. Pick what to send.",
    );
  });

  it("has a sentence for every Needs you kind", () => {
    for (const kind of NeedsYouKind.options) {
      const item =
        kind === "record" ? record : kind === "details" ? details : taskItem(kind, later(120));
      expect(headlineFor(item, NOW), kind).toMatch(/\.$|\?$/);
    }
  });

  it("asks which request unmatched mail belongs to", () => {
    expect(headlineFor(mail(null))).toBe(
      "A reply from privacy@acme.example doesn't match an open request. Is it about one of these?",
    );
  });

  it("asks what matched mail means when nothing could tell", () => {
    expect(headlineFor(mail("r1"))).toBe(
      "Acme Data replied, and we couldn't tell what it means. What is it?",
    );
  });

  it("states a failure in the cause's words", () => {
    expect(
      headlineFor(
        withTask("failed", "net::ERR_CONNECTION_RESET at https://www.cardinal.example/optout"),
      ),
    ).toBe(
      "The removal for Cardinal Insights failed: could not reach the site. Retry it or dismiss it.",
    );
  });

  it("says an agent task is waiting and the person can take it", () => {
    expect(headlineFor(withTask("agents", null))).toBe(
      "Waiting for an agent to remove you from Cardinal Insights. You can finish it yourself.",
    );
  });

  it("never prints a dash, a task id or a url", () => {
    const sentences = [
      headlineFor(taskItem("hold", later(300)), NOW),
      headlineFor(mail(null)),
      headlineFor(withTask("failed", null)),
    ];
    for (const sentence of sentences) expect(sentence).not.toMatch(/\u2014|task:|https?:/);
  });
});
