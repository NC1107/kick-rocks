import type { TargetSummary } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { allowedSitesFor, refuseNavigation, withinSites } from "./domains.js";

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

describe("allowedSitesFor", () => {
  it("trusts the target's domain once, without www, and its subdomains need no entry", () => {
    expect(allowedSitesFor(target())).toEqual({ domains: ["example-broker.test"], pages: [] });
    expect(
      allowedSitesFor(target({ optOutUrl: null }), [
        "https://records.example-broker.test/p/1",
        null,
        "not a url",
      ]),
    ).toEqual({ domains: ["example-broker.test"], pages: [] });
  });

  it("trusts the website host as a whole when it differs from the domain", () => {
    expect(
      allowedSitesFor(target({ domain: "brand.test", website: "https://www.parent.test/" }))
        .domains,
    ).toEqual(["brand.test", "parent.test"]);
  });

  it("limits a start page on another host to its own folder", () => {
    const sites = allowedSitesFor(
      target({
        optOutUrl: "https://docs.google.com/forms/d/e/ABC123/viewform?usp=sf_link",
        searchUrl: "https://privacyportal.onetrust.com/webform/tenant-1/form-9",
      }),
      ["https://other.test/people/jordan-1"],
    );
    expect(sites.domains).toEqual(["example-broker.test"]);
    expect(sites.pages).toEqual([
      { host: "docs.google.com", path: "/forms/d/e/ABC123/" },
      { host: "privacyportal.onetrust.com", path: "/webform/tenant-1/" },
      { host: "other.test", path: "/people/" },
    ]);
  });

  it("limits a one-segment start page to that page and what is under it", () => {
    const { pages } = allowedSitesFor(target({ optOutUrl: "https://forms.gle/S7vW6zXPwgtnZ9ZF9" }));
    expect(pages).toEqual([{ host: "forms.gle", path: "/S7vW6zXPwgtnZ9ZF9" }]);
  });
});

describe("withinSites", () => {
  const sites = {
    domains: ["example-broker.test"],
    pages: [
      { host: "docs.google.com", path: "/forms/d/e/ABC123/" },
      { host: "forms.gle", path: "/S7vW" },
    ],
  };

  it("allows the form's own pages and nothing else on a shared host", () => {
    expect(withinSites("https://docs.google.com/forms/d/e/ABC123/viewform", sites)).toBe(true);
    expect(withinSites("https://docs.google.com/forms/d/e/ABC123/formResponse", sites)).toBe(true);
    expect(withinSites("https://docs.google.com/forms/d/e/OTHER/viewform", sites)).toBe(false);
    expect(withinSites("https://docs.google.com/forms/d/e/ABC1234/viewform", sites)).toBe(false);
    expect(withinSites("https://docs.google.com/forms/d/e/ABC123/../OTHER/viewform", sites)).toBe(
      false,
    );
    expect(
      withinSites("https://docs.google.com/forms/d/e/ABC123/%2e%2e/OTHER/viewform", sites),
    ).toBe(false);
    expect(withinSites("https://accounts.docs.google.com/forms/d/e/ABC123/x", sites)).toBe(false);
    expect(withinSites("https://forms.gle/S7vW", sites)).toBe(true);
    expect(withinSites("https://forms.gle/S7vWother", sites)).toBe(false);
  });
});

describe("refuseNavigation", () => {
  const policy = { domains: ["example-broker.test"], pages: [], allowHttp: false };

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
    const local = { domains: ["127.0.0.1"], pages: [], allowHttp: true };
    expect(refuseNavigation("http://127.0.0.1:8631/optout", local)).toBeNull();
    expect(refuseNavigation("http://localhost:8631/optout", local)).toContain("not one of");
  });

  it("names the allowed domains in the reason, so the model can see its mistake", () => {
    expect(refuseNavigation("https://other.test/", policy)).toContain("example-broker.test");
  });
});
