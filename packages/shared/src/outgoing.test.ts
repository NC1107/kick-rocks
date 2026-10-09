import { describe, expect, it } from "vitest";
import {
  isContactField,
  isTokenShaped,
  matchesApproved,
  type OutgoingRequest,
  type OutgoingValue,
} from "./outgoing.js";

const TOKEN = "k3J9xQ2mLw8TzP4vRb7YcN1d";
const OTHER_TOKEN = "Zz8Qw1Er5Ty9Ui3Op7As2Df6";

function request(overrides: Partial<OutgoingRequest> = {}): OutgoingRequest {
  return {
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
      { path: "csrf", value: TOKEN, class: "served_token" },
      { path: "kind", value: "delete", class: "literal" },
    ],
    headers: [],
    bodyBytes: 60,
    bodyDigest: "a".repeat(64),
    carries: ["email"],
    ...overrides,
  };
}

const withBody = (body: OutgoingValue[]) => request({ body });

describe("matchesApproved", () => {
  it("refuses a request that also carries a value the approved one did not", () => {
    const next = request({ carries: ["email", "phone"] });
    expect(matchesApproved(next, request())).toBe(false);
  });

  it("refuses a value that holds more fields than the approved one", () => {
    const note = (fields: OutgoingValue["fields"]) =>
      request({ body: [{ path: "note", value: "x", class: "profile", fields }] });
    expect(matchesApproved(note(["email", "phone"]), note(["email"]))).toBe(false);
    expect(matchesApproved(note(["phone", "email"]), note(["email", "phone"]))).toBe(true);
  });

  it("accepts the same request", () => {
    expect(matchesApproved(request(), request())).toBe(true);
  });

  it("accepts a different token the site served, when both look like one", () => {
    const next = withBody([
      { path: "email", value: "{{email}}", class: "profile", fields: ["email"] },
      { path: "csrf", value: OTHER_TOKEN, class: "served_token" },
      { path: "kind", value: "delete", class: "literal" },
    ]);
    expect(matchesApproved(next, request())).toBe(true);
  });

  it("refuses a different value that the site did not serve", () => {
    const next = withBody([
      { path: "email", value: "{{email}}", class: "profile", fields: ["email"] },
      { path: "csrf", value: OTHER_TOKEN, class: "literal" },
      { path: "kind", value: "delete", class: "literal" },
    ]);
    expect(matchesApproved(next, request())).toBe(false);
  });

  it("refuses another long value of a group when neither was a served token", () => {
    const pick = (value: string) => withBody([{ path: "scope", value, class: "literal" }]);
    expect(
      matchesApproved(pick("share_with_partner_brands_ok"), pick("suppress_marketing_only_please")),
    ).toBe(false);
  });

  it("refuses a short value passed off as a token", () => {
    const base = withBody([{ path: "share", value: "no", class: "served_token" }]);
    const next = withBody([{ path: "share", value: "yes", class: "served_token" }]);
    expect(matchesApproved(next, base)).toBe(false);
  });

  it("refuses a literal that is not exactly the same", () => {
    const next = withBody([
      { path: "email", value: "{{email}}", class: "profile", fields: ["email"] },
      { path: "csrf", value: TOKEN, class: "served_token" },
      { path: "kind", value: "access", class: "literal" },
    ]);
    expect(matchesApproved(next, request())).toBe(false);
  });

  it("refuses a field that was added or left out", () => {
    const extra = withBody([...request().body, { path: "offers", value: "yes", class: "literal" }]);
    expect(matchesApproved(extra, request())).toBe(false);
    expect(matchesApproved(request(), extra)).toBe(false);
    expect(matchesApproved(withBody(request().body.slice(0, 2)), request())).toBe(false);
  });

  it("refuses a value that holds a different detail of the person", () => {
    const next = withBody([
      { path: "email", value: "{{phone}}", class: "profile", fields: ["phone"] },
      ...request().body.slice(1),
    ]);
    expect(matchesApproved(next, request())).toBe(false);
  });

  it.each([
    ["method", { method: "PUT" }],
    ["host", { host: "other.test" }],
    ["path", { path: "/gate-newsletter" }],
    ["document-ness", { isDocument: false }],
    [
      "target type",
      { target: { type: "worker", frameOrigin: "https://broker.test", topLevel: false } },
    ],
    ["frame origin", { target: { type: "page", frameOrigin: "https://x.test", topLevel: true } }],
    ["body kind", { bodyKind: "json" as const }],
  ])("refuses a request with another %s", (_, change) => {
    expect(matchesApproved(request(change), request())).toBe(false);
  });

  it("never matches a body that could not be read, whoever it is compared to", () => {
    const opaque = request({ bodyKind: "opaque", body: [] });
    expect(matchesApproved(opaque, opaque)).toBe(false);
  });

  it("keeps repeated names in order", () => {
    const base = withBody([
      { path: "tag", value: "a", class: "literal" },
      { path: "tag", value: "b", class: "literal" },
    ]);
    const swapped = withBody([
      { path: "tag", value: "b", class: "literal" },
      { path: "tag", value: "a", class: "literal" },
    ]);
    expect(matchesApproved(base, base)).toBe(true);
    expect(matchesApproved(swapped, base)).toBe(false);
  });
});

describe("isTokenShaped", () => {
  it("takes what a site generates for one load for a token", () => {
    expect(isTokenShaped(TOKEN)).toBe(true);
    expect(isTokenShaped("9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08")).toBe(
      true,
    );
    expect(isTokenShaped("4a7d1ed414474e4033ac29ccb8653d9b")).toBe(true);
  });

  it("does not take a choice or a word for one", () => {
    for (const value of ["yes", "partners", "this-site", "delete", "no", "on", "2026-10-07"]) {
      expect(isTokenShaped(value), value).toBe(false);
    }
    expect(isTokenShaped("a".repeat(40))).toBe(false);
  });
});

describe("isContactField", () => {
  it("treats everything that is not a lookup value as a contact value", () => {
    for (const field of ["email", "phone", "street", "date_of_birth", "other"] as const) {
      expect(isContactField(field)).toBe(true);
    }
    for (const field of [
      "first_name",
      "last_name",
      "city",
      "state",
      "zip",
      "birth_year",
      "record_url",
    ] as const) {
      expect(isContactField(field)).toBe(false);
    }
  });
});
