import { resolve } from "node:path";
import type { Broker, Recipe } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { buildDataset, loadPinnedIds } from "./build.js";
import { readBundledRecipes, unpairedRecipeSenders } from "./recipe-senders.js";
import { applyReplyDomains } from "./reply-domains.js";

function broker(id: string, domain: string, replyDomains?: string[]): Broker {
  return {
    id,
    name: id,
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
    ...(replyDomains ? { replyDomains } : {}),
    regulatedBy: [],
    collectsMinors: null,
    collectsGeolocation: null,
    collectsReproductiveHealth: null,
    metrics: null,
    notes: null,
    sources: [{ source: "kickrocks", license: "PolyForm-Noncommercial-1.0.0" }],
  };
}

const recipesDir = resolve(import.meta.dirname, "..", "..", "recipes", "recipes");
const template = readBundledRecipes(recipesDir).find((r) => r.id === "spokeo.remove.v1");

function recipe(brokerId: string, fromDomain: string, alsoFor: string[] = []): Recipe {
  if (!template) throw new Error("spokeo.remove.v1 is the template for these tests");
  return {
    ...template,
    id: `${brokerId}.remove.v1`,
    brokerId,
    alsoFor,
    steps: template.steps.map((step) =>
      step.kind === "email_confirmation" ? { ...step, fromDomain } : step,
    ),
  };
}

describe("unpairedRecipeSenders", () => {
  it("accepts the broker's own site and its subdomains", () => {
    const brokers = [broker("acme", "acme.test")];
    expect(unpairedRecipeSenders(brokers, [recipe("acme", "mail.acme.test")])).toEqual([]);
  });

  it("accepts a sister domain the broker curates", () => {
    const brokers = [broker("acme", "acme.test", ["sister.test"])];
    expect(unpairedRecipeSenders(brokers, [recipe("acme", "sister.test")])).toHaveLength(0);
  });

  it("flags a sister domain that no broker entry curates", () => {
    const brokers = [broker("acme", "acme.test")];
    expect(unpairedRecipeSenders(brokers, [recipe("acme", "sister.test")])).toEqual([
      expect.stringContaining("sister.test"),
    ]);
  });

  it("checks every broker an also-for recipe serves", () => {
    const brokers = [broker("acme", "acme.test"), broker("beta", "beta.test", ["acme.test"])];
    const problems = unpairedRecipeSenders(brokers, [recipe("acme", "acme.test", ["beta"])]);
    expect(problems).toEqual([]);
    expect(unpairedRecipeSenders(brokers, [recipe("beta", "beta.test", ["acme"])])).toEqual([
      expect.stringContaining("acme"),
    ]);
  });

  it("flags a recipe for a broker the dataset does not list", () => {
    expect(unpairedRecipeSenders([], [recipe("ghost", "ghost.test")])).toHaveLength(1);
  });
});

describe("applyReplyDomains", () => {
  const yaml = (id: string) =>
    `reply_domains:\n  - broker: ${id}\n    domains: [sister.test]\n    note: sister brand\n`;

  it("attaches the curated domains to their broker", () => {
    const [acme] = applyReplyDomains([broker("acme", "acme.test")], yaml("acme"));
    expect(acme?.replyDomains).toEqual(["sister.test"]);
  });

  it("rejects an entry for a broker the dataset does not list", () => {
    expect(() => applyReplyDomains([broker("acme", "acme.test")], yaml("ghost"))).toThrow(/ghost/);
  });

  it("rejects a shared mail host", () => {
    const text = "reply_domains:\n  - broker: acme\n    domains: [gmail.com]\n    note: no\n";
    expect(() => applyReplyDomains([broker("acme", "acme.test")], text)).toThrow();
  });
});

describe("the bundled recipes", () => {
  const recipes = readBundledRecipes(
    resolve(import.meta.dirname, "..", "..", "recipes", "recipes"),
  );

  it("all wait for mail from a sender their broker accepts", () => {
    const { brokers } = buildDataset(loadPinnedIds());
    expect(unpairedRecipeSenders(brokers, recipes)).toEqual([]);
  });

  it("would fail the data build without the curated sister domains", () => {
    const { brokers } = buildDataset(loadPinnedIds());
    const bare = brokers.map(({ replyDomains: _dropped, ...rest }) => rest);
    expect(unpairedRecipeSenders(bare, recipes).length).toBeGreaterThan(0);
  });
});
