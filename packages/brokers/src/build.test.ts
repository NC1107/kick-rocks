import { needsRecord, normalizeDomain, RECORD_NOT_NEEDED } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { buildDataset, loadPinnedIds, pinNewIds } from "./build.js";
import { readPinnedUpstream } from "./upstream.js";

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

describe("the generated broker dataset", () => {
  const pinned = loadPinnedIds();
  const dataset = buildDataset(pinned);

  it("carries its license and attribution", () => {
    expect(dataset.license).toBe("CC-BY-NC-SA-4.0");
    expect(dataset.attribution).toMatch(/Yael Grauer/);
    expect(dataset.attribution).toMatch(/Optery/);
  });

  it("has a valid hostname for every broker, so no site is listed twice under a broken domain", () => {
    const bad = dataset.brokers.filter((broker) => !HOSTNAME.test(broker.domain));
    expect(bad.map((broker) => `${broker.id} ${broker.domain}`)).toEqual([]);
    for (const broker of dataset.brokers) {
      expect(normalizeDomain(broker.domain), broker.id).toBe(broker.domain);
    }
  });

  it("uses one id per domain and one domain per id", () => {
    expect(new Set(dataset.brokers.map((b) => b.id)).size).toBe(dataset.brokers.length);
    expect(new Set(dataset.brokers.map((b) => b.domain)).size).toBe(dataset.brokers.length);
  });

  it("pins every id, so an upstream change cannot rename a broker a recipe refers to", () => {
    const unpinned = dataset.brokers
      .filter((broker) => pinned[broker.domain] !== broker.id)
      .map((broker) => `${broker.domain} -> ${broker.id}`);
    // Fix with `pnpm data:build` and commit packages/brokers/data/ids.json.
    expect(unpinned).toEqual([]);
  });

  it("keeps the ids that recipes are written against", () => {
    const ids = new Map(dataset.brokers.map((broker) => [broker.domain, broker.id]));
    for (const [domain, id] of Object.entries({
      "spokeo.com": "spokeo",
      "whitepages.com": "whitepages",
      "beenverified.com": "beenverified",
      "intelius.com": "intelius",
      "peopleconnect.us": "peopleconnect",
      "mylife.com": "mylife",
      "nuwber.com": "nuwber",
      "peoplefinders.com": "peoplefinders",
      "thatsthem.com": "thatsthem",
      "fastpeoplesearch.com": "fastpeoplesearch",
      "truepeoplesearch.com": "truepeoplesearch",
      "usphonebook.com": "usphonebook",
      "familytreenow.com": "familytreenow",
      "checkpeople.com": "checkpeople",
    })) {
      expect(ids.get(domain), domain).toBe(id);
    }
  });

  it("keeps the reserved ids and fills them with records", () => {
    const byId = new Map(dataset.brokers.map((broker) => [broker.id, broker]));
    expect(pinned["radaris.com"]).toBe("radaris");
    expect(byId.get("clustrmaps")?.domain).toBe("clustrmaps.com");
    expect(byId.get("smartbackgroundchecks")?.domain).toBe("smartbackgroundchecks.com");
  });

  it("leaves Radaris out because the BADBOOL list dropped it when its domains were transferred", () => {
    expect(dataset.brokers.some((broker) => broker.domain === "radaris.com")).toBe(false);
  });

  it("lets BADBOOL win over Eraser and the registry for a site all three list", () => {
    const whitepages = dataset.brokers.find((broker) => broker.domain === "whitepages.com");
    expect(whitepages?.sources.map((source) => source.source)).toEqual([
      "badbool",
      "eraser",
      "ca-registry-2026",
      "optery",
    ]);
    expect(whitepages?.optOutUrl).toBe("https://www.whitepages.com/suppression_requests");
    expect(whitepages?.priority).toBe("crucial");
  });

  it("applies the hand-checked corrections over the imported contacts", () => {
    const byDomain = new Map(dataset.brokers.map((broker) => [broker.domain, broker]));
    expect(byDomain.get("thebridgecorp.com")?.privacyEmail).toBe("privacy@thebridgecorp.com");
    expect(byDomain.get("choreograph.com")).toMatchObject({
      privacyEmail: "privacy@choreograph.com",
      privacyRightsUrl: "https://www.choreograph.com/ccpa",
    });
    expect(byDomain.get("foursquare.com")?.privacyEmail).toBe("privacy@foursquare.com");
    expect(byDomain.get("nctue.com")?.privacyEmail).toBe("admin@nctue.com");
    expect(byDomain.get("mailinglists.com")).toMatchObject({
      privacyEmail: "privacy@mailinglists.com",
      website: "https://mailinglists.com",
    });
    expect(byDomain.has("mlxp.com")).toBe(false);
  });

  it("uses no California registry contact that is a named person or on a foreign host", () => {
    const plug = dataset.brokers.find((broker) => broker.domain === "plug-industries.com");
    expect(plug?.sources.map((source) => source.source)).toEqual(["ca-registry-2026"]);
    expect(plug?.privacyEmail).toBeNull();
  });

  it("carries the Optery directory with its own license", () => {
    const optery = dataset.brokers.filter((broker) =>
      broker.sources.some((source) => source.source === "optery"),
    );
    expect(optery.length).toBeGreaterThan(500);
    for (const broker of optery) {
      const source = broker.sources.find((s) => s.source === "optery");
      expect(source?.license, broker.id).toBe("CC-BY-NC-SA-4.0");
    }
  });

  it("fills a field BADBOOL lacks from Eraser", () => {
    const intelius = dataset.brokers.find((broker) => broker.domain === "intelius.com");
    expect(intelius?.privacyEmail).not.toBeNull();
  });

  it("puts curated records after every import", () => {
    const clustrmaps = dataset.brokers.find((broker) => broker.id === "clustrmaps");
    expect(clustrmaps?.sources.at(-1)?.source).toBe("kickrocks");
  });

  it("leaves out the sites BADBOOL dropped and the domains of company targets", () => {
    const domains = new Set(dataset.brokers.map((broker) => broker.domain));
    for (const domain of ["rehold.com", "opendatausa.com", "salesforce.com", "shopify.com"]) {
      expect(domains.has(domain), domain).toBe(false);
    }
  });

  it("refuses to build from a README that no longer matches its pin", () => {
    expect(() => readPinnedUpstream("BADBOOL-README.md", { source: "missing.json" })).toThrow();
  });
});

describe("pinNewIds", () => {
  it("adds ids for new domains, never changes an existing one, and keeps the map sorted", () => {
    const dataset = buildDataset({});
    const next = pinNewIds({ "spokeo.com": "pinned-spokeo", "zzz.example": "reserved" }, dataset);
    expect(next["spokeo.com"]).toBe("pinned-spokeo");
    expect(next["zzz.example"]).toBe("reserved");
    expect(Object.keys(next)).toEqual([...Object.keys(next)].sort((a, b) => a.localeCompare(b)));
    expect(Object.keys(next).length).toBeGreaterThan(dataset.brokers.length);
  });
});

describe("record-first removal", () => {
  it("starts every people-search and background-check broker from a scan", async () => {
    const sites = buildDataset(loadPinnedIds()).brokers.filter(
      (broker) => broker.category === "people-search" || broker.category === "background-check",
    );
    expect(sites.length).toBeGreaterThan(20);
    for (const site of sites) {
      expect(needsRecord(site), site.id).toBe(!RECORD_NOT_NEEDED.has(site.id));
    }
  });
});
