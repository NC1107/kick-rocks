import type { OutgoingRequest, SendLog, SendRow } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  badgesOf,
  carriedSteps,
  countdown,
  destinationOf,
  fieldRows,
  frameLabel,
  kindLabel,
  latestRun,
  liveHolds,
  logLine,
  nextRunHolds,
  refusalText,
  restore,
  summarize,
  unreadableNote,
} from "./sends-model.js";

const request = (overrides: Partial<OutgoingRequest> = {}): OutgoingRequest => ({
  method: "POST",
  scheme: "https",
  host: "broker.test",
  path: "/optout",
  resourceType: "Document",
  isDocument: true,
  target: { type: "page", frameOrigin: "https://broker.test", topLevel: true },
  party: "target",
  bodyKind: "form",
  query: [],
  body: [
    { path: "email", value: "{{email}}", class: "profile", fields: ["email"] },
    { path: "csrf", value: "k3J9xQ2mLw8TzP4vRb7YcN1d", class: "served_token" },
    { path: "kind", value: "delete", class: "literal" },
  ],
  headers: [],
  bodyBytes: 40,
  bodyDigest: "a".repeat(64),
  carries: ["email"],
  ...overrides,
});

let counter = 0;
const row = (overrides: Partial<SendRow> = {}): SendRow => {
  counter += 1;
  return rowAt(counter, overrides);
};
const rowAt = (seq: number, overrides: Partial<SendRow>): SendRow => ({
  id: `row-${seq}`,
  attempt: 1,
  seq,
  kind: "held",
  status: "pending_live",
  request: request(),
  reason: null,
  spendsSendId: null,
  hasScreenshot: false,
  expiresAt: "2026-10-07T00:10:00.000Z",
  decidedBy: null,
  decidedAt: null,
  releasedAt: null,
  responseStatus: null,
  responseError: null,
  createdAt: "2026-10-07T00:00:00.000Z",
  resend: false,
  ...overrides,
});

const NOW = Date.parse("2026-10-07T00:05:00.000Z");

describe("restore", () => {
  it("puts the person's values back where placeholders stand, and leaves unknown ones alone", () => {
    expect(restore("{{email}} / {{other_9}}", { "{{email}}": "me@example.com" })).toBe(
      "me@example.com / {{other_9}}",
    );
  });
});

describe("what a held request looks like", () => {
  it("tells a form submission from a background request", () => {
    expect(kindLabel(request())).toBe("Form submission (page load)");
    expect(kindLabel(request({ isDocument: false }))).toBe("Background request");
  });

  it("marks a destination that is not the target's own site", () => {
    expect(destinationOf(request())).toEqual({ text: "broker.test/optout", offSite: false });
    expect(destinationOf(request({ party: "third", host: "ads.test" })).offSite).toBe(true);
  });

  it("names the frame the request came from", () => {
    expect(frameLabel(request())).toBe("this page");
    expect(
      frameLabel(
        request({
          target: { type: "iframe", frameOrigin: "https://partner.test", topLevel: false },
        }),
      ),
    ).toBe("a frame of https://partner.test");
    expect(
      frameLabel(
        request({
          target: { type: "worker", frameOrigin: "https://broker.test", topLevel: false },
        }),
      ),
    ).toBe("a worker of https://broker.test");
  });

  it("badges what is the person's, what the site set, and nothing for the rest", () => {
    const [email, csrf, kind] = request().body;
    expect(badgesOf(email as never)).toEqual([{ text: "your email address", tone: "attention" }]);
    expect(badgesOf(csrf as never)).toEqual([
      { text: "set by the site, may change next run", tone: "neutral" },
    ]);
    expect(badgesOf(kind as never)).toEqual([]);
  });

  it("lists every field with the person's values restored, and says where each is", () => {
    const rows = fieldRows(request({ query: [{ path: "q", value: "x", class: "literal" }] }), {
      "{{email}}": "me@example.com",
    });
    expect(rows.map((entry) => [entry.where, entry.name, entry.value])).toEqual([
      ["address", "q", "x"],
      ["body", "email", "me@example.com"],
      ["body", "csrf", "k3J9xQ2mLw8TzP4vRb7YcN1d"],
      ["body", "kind", "delete"],
    ]);
  });

  it("says when a body holds none of the person's details that could be read", () => {
    expect(unreadableNote(request({ bodyKind: "opaque", body: [] }))).toBe(
      "contains none of your details we can read",
    );
    expect(unreadableNote(request({ carries: [] }))).toBe(
      "contains none of your details we can read",
    );
    expect(unreadableNote(request())).toBeNull();
  });

  it("counts down in minutes and seconds, and stops at zero", () => {
    expect(countdown("2026-10-07T00:10:00.000Z", NOW)).toBe("5:00");
    expect(countdown("2026-10-07T00:05:09.000Z", NOW)).toBe("0:09");
    expect(countdown("2026-10-07T00:00:00.000Z", NOW)).toBe("0:00");
    expect(countdown(null, NOW)).toBeNull();
  });
});

describe("which rows a person decides about", () => {
  const started = () =>
    row({ kind: "guard_event", status: "done", request: { note: "Run 2" }, reason: "run_started" });
  const start = started();
  const log = (sends: SendRow[]): SendLog => ({
    sends,
    values: {},
    runStartedSeq: sends.find((entry) => entry.reason === "run_started")?.seq ?? 0,
  });

  it("looks only at the latest run", () => {
    const old = row();
    const begun = started();
    const current = row();
    expect(latestRun(log([old, begun, current]))).toEqual([begun, current]);
  });

  it("lists requests waiting right now, and not one whose hold has run out", () => {
    const waiting = row();
    const lapsed = row({ expiresAt: "2026-10-07T00:01:00.000Z" });
    expect(liveHolds(log([start, waiting, lapsed]), NOW)).toEqual([waiting]);
  });

  it("lists the requests left for the next run, approved or not yet", () => {
    const later = row({ status: "awaiting_next_run", expiresAt: null });
    const approved = row({ status: "approved_next_run", expiresAt: null });
    const declined = row({ status: "declined" });
    expect(nextRunHolds(log([start, later, approved, declined]))).toEqual([later, approved]);
  });

  it("finds the steps that already went out in a run that lapsed", () => {
    const sent = row({ status: "sent", releasedAt: "2026-10-07T00:01:00.000Z", expiresAt: null });
    const approvedOnly = row({ status: "sent", releasedAt: null });
    expect(carriedSteps(log([start, sent, approvedOnly]))).toEqual([sent]);
  });
});

describe("the log of what left the browser", () => {
  it("says nothing left when nothing was released and no channel escaped", () => {
    expect(summarize({ sends: [row()] })).toEqual({
      released: 0,
      unguarded: false,
      nothingLeft: true,
    });
  });

  it("counts the requests released, and a channel the gate could not read", () => {
    const released = row({ kind: "released", status: "sent" });
    const escaped = row({
      kind: "guard_event",
      status: "done",
      request: { note: "WebSocket" },
      reason: "unguarded:websocket",
    });
    expect(summarize({ sends: [released, released] })).toMatchObject({
      released: 2,
      nothingLeft: false,
    });
    expect(summarize({ sends: [escaped] })).toMatchObject({ unguarded: true, nothingLeft: false });
  });

  it("describes a row in words without the person's values", () => {
    expect(logLine(row({ kind: "released", status: "sent", responseStatus: 200 }), {})).toEqual({
      title: "Sent",
      detail: "POST broker.test/optout, with email address, answered 200",
    });
    expect(
      logLine(row({ kind: "lookup", request: request({ method: "GET", carries: ["city"] }) }), {}),
    ).toEqual({ title: "Looked something up", detail: "GET broker.test/optout, with city" });
    expect(logLine(row({ kind: "refused", reason: "third_party_value" }), {}).title).toBe(
      "Blocked: it carried your details to another site",
    );
    expect(
      logLine(row({ kind: "guard_event", request: { note: "Hello {{email}}" }, reason: "x" }), {
        "{{email}}": "me@example.com",
      }).title,
    ).toBe("Hello me@example.com");
  });

  it("explains each reason a request was refused, and any other one generically", () => {
    expect(refusalText("unreadable_body")).toContain("cannot be approved");
    expect(refusalText("something_new")).toBe("Blocked by the safety gate");
  });
});
