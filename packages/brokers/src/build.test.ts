import { needsRecord, normalizeDomain, RECORD_NOT_NEEDED } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { buildDataset, loadPinnedIds, pinNewIds } from "./build.js";

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

describe("the generated broker dataset", () => {
  const pinned = loadPinnedIds();
  const dataset = buildDataset(pinned);

  it("carries its license and attribution", () => {
    expect(dataset.license).toBe("CC-BY-NC-SA-4.0");
    expect(dataset.attribution).toMatch(/Yael Grauer/);
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

  it("reserves the ids of sites whose records the dataset does not have yet", () => {
    expect(pinned["radaris.com"]).toBe("radaris");
    expect(pinned["clustrmaps.com"]).toBe("clustrmaps");
    expect(pinned["smartbackgroundchecks.com"]).toBe("smartbackgroundchecks");
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
