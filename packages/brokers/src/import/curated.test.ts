import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCuratedBrokers } from "./curated.js";

const file = resolve(import.meta.dirname, "..", "..", "data", "curated-brokers.yaml");

const valid = `brokers:
  - id: example-people
    name: Example People
    domain: example.com
    category: people-search
    website: https://example.com
    search_url: https://example.com/search
    opt_out_url: https://www.example.com/optout
    email: privacy@example.com
    requirements: [record_url, id_upload]
    priority: high
`;

describe("parseCuratedBrokers", () => {
  it("builds a broker with the project's own source and license", () => {
    const [broker] = parseCuratedBrokers(valid);
    expect(broker).toMatchObject({
      id: "example-people",
      domain: "example.com",
      contactMethod: "both",
      priority: "high",
      requiresId: true,
      region: "us",
      sources: [{ source: "kickrocks", license: "PolyForm-Noncommercial-1.0.0" }],
    });
  });

  it("fills defaults for optional fields", () => {
    const [broker] = parseCuratedBrokers(
      "brokers:\n  - {id: tiny, name: Tiny, domain: tiny.example, category: marketing}\n",
    );
    expect(broker).toMatchObject({
      website: null,
      privacyEmail: null,
      optOutUrl: null,
      searchUrl: null,
      contactMethod: "unknown",
      priority: "normal",
      requirements: [],
    });
  });

  it("rejects a link that is off the broker's domain", () => {
    expect(() =>
      parseCuratedBrokers(valid.replace("https://www.example.com/optout", "https://evil.test/x")),
    ).toThrow(/off example.com/);
  });

  it("rejects a domain that is not in its normal form", () => {
    expect(() =>
      parseCuratedBrokers(valid.replace("domain: example.com", "domain: www.example.com")),
    ).toThrow(/normal form/);
  });

  it("rejects a non-web url, a bad category, and a bad id", () => {
    expect(() =>
      parseCuratedBrokers(valid.replace("https://example.com/search", "javascript:x")),
    ).toThrow();
    expect(() => parseCuratedBrokers(valid.replace("people-search", "nonsense"))).toThrow();
    expect(() => parseCuratedBrokers(valid.replace("example-people", "Bad Id"))).toThrow();
  });

  it("rejects a file without a brokers list", () => {
    expect(() => parseCuratedBrokers("other: []")).toThrow();
  });
});

describe("the committed curated list", () => {
  const brokers = parseCuratedBrokers(readFileSync(file, "utf8"));

  it("parses and carries ClustrMaps for the bundled recipes", () => {
    expect(brokers.find((broker) => broker.id === "clustrmaps")).toMatchObject({
      domain: "clustrmaps.com",
      category: "people-search",
    });
  });

  it("uses unique ids and domains", () => {
    expect(new Set(brokers.map((broker) => broker.id)).size).toBe(brokers.length);
    expect(new Set(brokers.map((broker) => broker.domain)).size).toBe(brokers.length);
  });
});
