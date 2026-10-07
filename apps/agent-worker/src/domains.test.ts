import type { TargetSummary } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { allowedDomainsFor, refuseNavigation } from "./domains.js";

const target = (overrides: Partial<TargetSummary> = {}): TargetSummary => ({
  id: "x",
  kind: "broker",
  name: "X",
  category: "people-search",
  domain: "www.example-broker.test",
  website: "https://www.example-broker.test/",
  optOutUrl: "https://privacy.example-broker.test/optout",
  searchUrl: null,
  contactMethod: "form",
  requiresId: false,
  requirements: [],
  priority: "normal",
  needsRecord: false,
  californiaRegistered: false,
  retired: false,
  ...overrides,
});

describe("allowedDomainsFor", () => {
  it("lists the target's own hosts once, without www", () => {
    expect(allowedDomainsFor(target())).toEqual([
      "example-broker.test",
      "privacy.example-broker.test",
    ]);
  });

  it("adds the hosts of the other pages the task names, and ignores nulls and junk", () => {
    expect(
      allowedDomainsFor(target({ optOutUrl: null }), [
        "https://records.example-broker.test/p/1",
        null,
        "not a url",
      ]),
    ).toEqual(["example-broker.test", "records.example-broker.test"]);
  });
});

describe("refuseNavigation", () => {
  const policy = { domains: ["example-broker.test"], allowHttp: false };

  it.each([
    "https://example-broker.test/optout",
    "https://www.example-broker.test/optout",
    "https://deep.sub.example-broker.test/x?y=1#z",
  ])("allows %s", (url) => {
    expect(refuseNavigation(url, policy)).toBeNull();
  });

  it.each([
    ["https://evil.test/", "not one of this target's domains"],
    ["https://example-broker.test.evil.test/", "not one of this target's domains"],
    ["https://evilexample-broker.test/", "not one of this target's domains"],
    ["http://example-broker.test/", "Only https"],
    ["javascript:alert(1)", "javascript address"],
    ["data:text/html,<h1>x</h1>", "data address"],
    ["file:///etc/passwd", "file address"],
    ["chrome://settings", "chrome address"],
    ["https://user:pw@example-broker.test/", "login"],
    ["nonsense", "not a valid URL"],
  ])("refuses %s", (url, reason) => {
    expect(refuseNavigation(url, policy)).toContain(reason);
  });

  it("allows plain http only when the worker is set to, for a fixture on this machine", () => {
    const local = { domains: ["127.0.0.1"], allowHttp: true };
    expect(refuseNavigation("http://127.0.0.1:8631/optout", local)).toBeNull();
    expect(refuseNavigation("http://localhost:8631/optout", local)).toContain("not one of");
  });

  it("names the allowed domains in the reason, so the model can see its mistake", () => {
    expect(refuseNavigation("https://other.test/", policy)).toContain("example-broker.test");
  });
});
