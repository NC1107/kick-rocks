import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Broker, Company, Recipe } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";

const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const read = (path: string): unknown => JSON.parse(readFileSync(resolve(FIXTURES, path), "utf8"));

describe("fixture targets and recipes", () => {
  const targets = read("targets.json") as { brokers: unknown[]; companies: unknown[] };
  const brokers = targets.brokers.map((record) => Broker.parse(record));
  const companies = targets.companies.map((record) => Company.parse(record));

  it("stay on reserved test domains, so no real site or address is ever involved", () => {
    for (const target of [...brokers, ...companies]) {
      expect(target.domain).toMatch(/\.test$/);
      if (target.privacyEmail) expect(target.privacyEmail).toMatch(/@[a-z0-9.-]+\.test$/);
    }
  });

  it("give every recipe a broker of its own and keep its pages on that broker's domain", () => {
    const files = readdirSync(resolve(FIXTURES, "recipes")).filter((name) =>
      name.endsWith(".json"),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const recipe = Recipe.parse(read(`recipes/${file}`));
      const broker = brokers.find((candidate) => candidate.id === recipe.brokerId);
      expect(broker, recipe.id).toBeDefined();
      expect(new URL(recipe.entryUrl).hostname).toBe(broker?.domain);
    }
  });
});
