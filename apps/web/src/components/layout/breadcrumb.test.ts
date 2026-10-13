import { describe, expect, it } from "vitest";
import { breadcrumbTrail } from "./breadcrumb.js";

describe("breadcrumbTrail", () => {
  it("names a top-level page alone", () => {
    expect(breadcrumbTrail("/")).toEqual([{ label: "Home" }]);
    expect(breadcrumbTrail("/review")).toEqual([{ label: "Inbox" }]);
  });

  it("links the list above a detail page and ends on the page itself", () => {
    expect(breadcrumbTrail("/requests/abc")).toEqual([
      { label: "Removals", to: "/requests" },
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

  it("puts the remove screen under its target", () => {
    expect(breadcrumbTrail("/targets/spokeo/remove", { label: "Spokeo" })).toEqual([
      { label: "Sites", to: "/targets" },
      { label: "Spokeo", to: "/targets/spokeo" },
      { label: "Remove my data" },
    ]);
  });

  it("nests the settings sub-pages", () => {
    expect(breadcrumbTrail("/settings/agents")).toEqual([
      { label: "Settings", to: "/settings" },
      { label: "Agents" },
    ]);
  });

  it("nests Profiles and About under Settings", () => {
    expect(breadcrumbTrail("/settings/profiles")).toEqual([
      { label: "Settings", to: "/settings" },
      { label: "Profiles" },
    ]);
    expect(breadcrumbTrail("/settings/about")).toEqual([
      { label: "Settings", to: "/settings" },
      { label: "About" },
    ]);
    expect(breadcrumbTrail("/profiles/new")).toEqual([
      { label: "Profiles", to: "/settings/profiles" },
      { label: "New" },
    ]);
  });

  it("falls back to Not found for an unknown path", () => {
    expect(breadcrumbTrail("/nope")).toEqual([{ label: "Not found" }]);
  });
});
