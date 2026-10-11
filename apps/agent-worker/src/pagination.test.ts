import { describe, expect, it } from "vitest";
import { paginationOf, readsAsPagination } from "./pagination.js";
import type { SnapshotControl } from "./snapshot.js";

function control(name: string, extra: Partial<SnapshotControl> = {}): SnapshotControl {
  return { t: "control", ref: "e1", role: "link", name, ...extra };
}

describe("controls that lead to more results", () => {
  it("reads a number, Next, More, View more, Show more, Load more and the arrows", () => {
    for (const name of [
      "2",
      "Next",
      "Next page",
      "Next ›",
      "Page 3",
      "More",
      "View more",
      "View 8 more results",
      "Show more",
      "Show more results",
      "Load more",
      "›",
      "»",
    ]) {
      expect(readsAsPagination(name), name).toBe(true);
    }
  });

  it("does not read other links and buttons", () => {
    for (const name of [
      "",
      "Privacy policy",
      "View free report",
      "Next steps for you",
      "2024 report",
      "Search",
      "Moreland, TX",
    ]) {
      expect(readsAsPagination(name), name).toBe(false);
    }
  });

  it("keeps links and buttons, with the address of a link, and leaves out a disabled control", () => {
    const found = paginationOf([
      control("2", { ref: "e5", href: "https://x.test/r?p=2" }),
      control("Load more", { ref: "e6", role: "button" }),
      control("3", { ref: "e7", disabled: true }),
      control("Home", { ref: "e8" }),
      control("Next", { ref: "e9", role: "textbox" }),
    ]);
    expect(found).toEqual([
      { ref: "e5", name: "2", href: "https://x.test/r?p=2" },
      { ref: "e6", name: "Load more" },
    ]);
  });
});
