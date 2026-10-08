import type { Broker } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { buildDataset, loadPinnedIds } from "./build.js";
import { applyOwnerGroups } from "./owner-groups.js";

function broker(domain: string): Broker {
  return {
    id: domain.split(".")[0] as string,
    name: domain,
    category: "people-search",
    website: `https://${domain}`,
    domain,
    privacyEmail: null,
    optOutUrl: null,
    privacyRightsUrl: null,
    searchUrl: null,
    contactMethod: "unknown",
    region: "us",
    requiresId: false,
    requirements: [],
    priority: "normal",
    regulatedBy: [],
    collectsMinors: null,
    collectsGeolocation: null,
    collectsReproductiveHealth: null,
    metrics: null,
    notes: null,
    sources: [{ source: "kickrocks", license: "PolyForm-Noncommercial-1.0.0" }],
  };
}

const group = (owner: string, domains: string[]) =>
  `owner_groups:\n  - owner: ${owner}\n    note: test\n    domains: [${domains.join(", ")}]\n`;

describe("applyOwnerGroups", () => {
  it("marks every listed broker with the group's key and leaves the rest alone", () => {
    const marked = applyOwnerGroups(
      [broker("one.test"), broker("two.test"), broker("other.test")],
      group("one.test", ["one.test", "two.test"]),
    );
    expect(marked.map((b) => b.ownerGroup)).toEqual(["one.test", "one.test", undefined]);
  });

  it("matches a broker by its registrable domain", () => {
    const [marked] = applyOwnerGroups(
      [broker("www.one.test")],
      group("one.test", ["one.test", "two.test"]),
    );
    expect(marked?.ownerGroup).toBe("one.test");
  });

  it("refuses a domain in two groups", () => {
    const yaml = `${group("a.test", ["a.test", "b.test"])}  - owner: c.test\n    note: test\n    domains: [b.test, c.test]\n`;
    expect(() => applyOwnerGroups([broker("a.test")], yaml)).toThrow(
      /b\.test is in the owner groups/,
    );
  });

  it("refuses a group that protects nobody", () => {
    expect(() =>
      applyOwnerGroups([broker("a.test")], group("x.test", ["x.test", "y.test"])),
    ).toThrow(/matches no broker/);
  });
});

describe("the curated owner groups in the dataset", () => {
  const dataset = buildDataset(loadPinnedIds());
  const ownerOf = (domain: string) => dataset.brokers.find((b) => b.domain === domain)?.ownerGroup;

  // Sister sites that share an operator must not be left ungrouped, or a campaign visits them
  // back to back against the same bot defences. Add a set here when one is found.
  const NETWORKS: string[][] = [
    [
      "truepeoplesearch.com",
      "fastpeoplesearch.com",
      "peoplesearchnow.com",
      "smartbackgroundchecks.com",
      "cyberbackgroundchecks.com",
      "advancedbackgroundchecks.com",
      "searchpeoplefree.com",
    ],
    ["beenverified.com", "neighborwho.com"],
    ["intelius.com", "instantcheckmate.com", "truthfinder.com", "addresses.com"],
    ["peoplefinders.com", "publicrecordsnow.com"],
  ];

  it.each(NETWORKS)("keeps %s and its sister sites in one group", (...domains) => {
    const owners = domains.map(ownerOf);
    expect(owners[0], domains.join(", ")).toBeDefined();
    expect(new Set(owners).size, domains.join(", ")).toBe(1);
  });
});
