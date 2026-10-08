import { describe, expect, it } from "vitest";
import { breadcrumbTrail } from "./breadcrumb.js";

describe("breadcrumbTrail", () => {
  it("names a top-level page alone", () => {
    expect(breadcrumbTrail("/")).toEqual([{ label: "Dashboard" }]);
    expect(breadcrumbTrail("/review")).toEqual([{ label: "Review" }]);
  });

  it("links the list above a detail page and ends on the page itself", () => {
    expect(breadcrumbTrail("/requests/abc")).toEqual([
      { label: "Requests", to: "/requests" },
      { label: "Request" },
    ]);
  });

  it("swaps the generic noun for the loaded name, keeping it mono for a reference", () => {
    const trail = breadcrumbTrail("/requests/abc", { label: "KR-7H3K2M", mono: true });
    expect(trail.at(-1)).toEqual({ label: "KR-7H3K2M", mono: true });
  });

  it("keeps the profile in the middle of a mailbox trail", () => {
    expect(breadcrumbTrail("/profiles/p1/mailbox").map((crumb) => crumb.label)).toEqual([
      "Profiles",
      "Profile",
      "Mailbox",
    ]);
  });

  it("nests the settings sub-pages", () => {
    expect(breadcrumbTrail("/settings/agents")).toEqual([
      { label: "Settings", to: "/settings" },
      { label: "Agents" },
    ]);
  });

  it("falls back to Not found for an unknown path", () => {
    expect(breadcrumbTrail("/nope")).toEqual([{ label: "Not found" }]);
  });
});
