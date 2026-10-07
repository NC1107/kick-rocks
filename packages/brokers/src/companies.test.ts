import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMPANY_DATASET_LICENSE,
  type Company,
  CompanyDataset,
  contactMethodFor,
  normalizeDomain,
} from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { buildDataset, loadPinnedIds } from "./build.js";
import { hasCompanyDataset, loadCompanies, loadCompanyDataset } from "./index.js";

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const file = resolve(import.meta.dirname, "..", "data", "companies.json");

describe("loadCompanyDataset", () => {
  it("loads the committed list with its license", () => {
    expect(hasCompanyDataset()).toBe(true);
    const dataset = loadCompanyDataset();
    expect(dataset.license).toBe(COMPANY_DATASET_LICENSE);
    expect(loadCompanies()).toEqual(dataset.companies);
  });

  it("parses the raw file with the shared schema", () => {
    expect(() => CompanyDataset.parse(JSON.parse(readFileSync(file, "utf8")))).not.toThrow();
  });
});

/**
 * Companies whose privacy page lives on a parent or processor site rather than the consumer
 * domain. Each page was read there, so the hostname is listed by hand.
 */
const FIRST_PARTY_HOST_EXCEPTIONS: Record<string, string[]> = {
  "23andme": ["www.23andme.org"],
  albertsons: ["www.albertsonscompanies.com"],
  cnn: ["www.wbdprivacy.com"],
  enterprise: ["www.enterprisemobility.com"],
  fandango: ["www.versantprivacy.com"],
  frontier: ["www.verizon.com"],
  gap: ["www.gapinc.com"],
  glassdoor: ["hrtechprivacy.com"],
  hulu: ["privacy.thewaltdisneycompany.com"],
  indeed: ["hrtechprivacy.com"],
  nbcuniversal: ["www.nbcuniversalprivacy.com"],
  paramount: ["www.viacomcbsprivacy.com"],
  peacock: ["www.nbcuniversalprivacy.com"],
  tripadvisor: ["tripadvisor.mediaroom.com"],
  twitch: ["legal.twitch.com"],
  warnerbrosdiscovery: ["www.wbdprivacy.com"],
  wsj: ["www.dowjones.com"],
  zoom: ["www.zoom.com"],
};

/**
 * Brands that answer to one parent privacy program and publish a single shared channel.
 * Each stays its own record because a person holds an account with the brand, not the parent.
 * A new collision must be added here on purpose.
 */
const SHARED_CONTACT_CHANNELS = [
  "globalprivacy@yum.com kfc,tacobell",
  "https://privacy.toyota.com/ lexus,toyota",
  "https://privacychoices.thewaltdisneycompany.com/en-US disney,hulu",
  "https://www.nbcuniversalprivacy.com/privacy/notrtoo nbcuniversal,peacock",
  "https://www.wbdprivacy.com/opt-out/ cnn,hbomax,warnerbrosdiscovery",
  "privacy@nbcuni.com nbcuniversal,peacock",
].sort();

function citedHost(company: Company): string {
  const cited = company.notes?.match(/^Contacts read from (https?:\/\/\S+) on /)?.[1];
  return new URL(cited ?? "https://invalid.invalid/").hostname;
}

function isOwnSite(company: Company): boolean {
  const host = citedHost(company);
  const family = company.domain.split(".").slice(-2).join(".");
  return host === family || host.endsWith(`.${family}`);
}

function isListedException(company: Company): boolean {
  return FIRST_PARTY_HOST_EXCEPTIONS[company.id]?.includes(citedHost(company)) ?? false;
}

describe("the company dataset", () => {
  const companies = loadCompanies();

  it("covers at least 150 major consumer companies", () => {
    expect(companies.length).toBeGreaterThanOrEqual(150);
  });

  it("covers every consumer category with a real spread, not one token entry each", () => {
    const counts = new Map<string, number>();
    for (const company of companies) {
      counts.set(company.category, (counts.get(company.category) ?? 0) + 1);
    }
    const minimums = {
      retail: 20,
      finance: 15,
      telecom: 8,
      tech: 20,
      media: 10,
      travel: 10,
      auto: 8,
      health: 8,
    };
    for (const [category, minimum] of Object.entries(minimums)) {
      expect(counts.get(category) ?? 0, category).toBeGreaterThanOrEqual(minimum);
    }
  });

  it("names the carriers, banks, and retailers a person is most likely to be tracked by", () => {
    const ids = new Set(companies.map((company) => company.id));
    for (const id of ["amazon", "wellsfargo", "bankofamerica", "lowes", "macys", "kohls"]) {
      expect(ids.has(id), id).toBe(true);
    }
  });

  it("has one id and one domain per company", () => {
    expect(new Set(companies.map((c) => c.id)).size).toBe(companies.length);
    expect(new Set(companies.map((c) => c.domain)).size).toBe(companies.length);
  });

  it("uses a valid hostname in its normal form for every company", () => {
    for (const company of companies) {
      expect(company.domain, company.id).toMatch(HOSTNAME);
      expect(normalizeDomain(company.domain), company.id).toBe(company.domain);
    }
  });

  it("gives every company a channel the campaign planner can act on, and states the contact method that way", () => {
    for (const company of companies) {
      expect(company.privacyEmail !== null || company.optOutUrl !== null, company.id).toBe(true);
      expect(company.contactMethod, company.id).toBe(
        contactMethodFor(company.privacyEmail, company.optOutUrl),
      );
    }
  });

  it("never leaves a request portal only in privacyRightsUrl, which the planner does not read", () => {
    const hidden = companies
      .filter((company) => company.privacyEmail === null && company.optOutUrl === null)
      .map((company) => company.id);
    expect(hidden).toEqual([]);
  });

  it("shares a contact channel between companies only where one privacy program serves several brands", () => {
    const owners = new Map<string, string[]>();
    for (const company of companies) {
      for (const channel of [company.privacyEmail, company.optOutUrl, company.privacyRightsUrl]) {
        if (channel) owners.set(channel, [...(owners.get(channel) ?? []), company.id]);
      }
    }
    const shared = [...owners]
      .filter(([, ids]) => ids.length > 1)
      .map(([channel, ids]) => `${channel} ${ids.join(",")}`)
      .sort();
    expect(shared).toEqual(SHARED_CONTACT_CHANNELS);
  });

  it("keeps emails lowercase and links on https or http only", () => {
    for (const company of companies) {
      if (company.privacyEmail)
        expect(company.privacyEmail).toBe(company.privacyEmail.toLowerCase());
      for (const url of [company.optOutUrl, company.privacyRightsUrl]) {
        if (url) expect(url, company.id).toMatch(/^https?:\/\//);
      }
    }
  });

  it("dates every check, never in the future", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const company of companies) {
      expect(company.verifiedAt, company.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(company.verifiedAt <= today, company.id).toBe(true);
    }
  });

  it("cites the company's own privacy page it was checked against", () => {
    for (const company of companies) {
      expect(company.notes, company.id).toMatch(
        /^Contacts read from https:\/\/\S+ on \d{4}-\d{2}-\d{2}\.$/,
      );
    }
  });

  it("reads each company's contacts from a page on its own site", () => {
    const offsite = companies
      .filter((company) => !isOwnSite(company) && !isListedException(company))
      .map((company) => `${company.id} cites ${citedHost(company)}`);
    expect(offsite).toEqual([]);
  });

  it("keeps the hand-listed off-domain hosts honest, with no entry the data no longer needs", () => {
    const byId = new Map(companies.map((company) => [company.id, company]));
    const stale = Object.entries(FIRST_PARTY_HOST_EXCEPTIONS).flatMap(([id, hosts]) => {
      const company = byId.get(id);
      if (!company) return [`${id} is not a company`];
      if (isOwnSite(company)) return [`${id} is on its own site`];
      return hosts.includes(citedHost(company)) ? [] : [`${id} cites another host`];
    });
    expect(stale).toEqual([]);
  });

  it("never lists a privacy contact on a free mail provider", () => {
    const free = /@(gmail|yahoo|hotmail|outlook|aol|proton|protonmail|icloud)\./;
    for (const company of companies) {
      expect(company.privacyEmail ?? "", company.id).not.toMatch(free);
    }
  });

  it("keeps links free of credentials and tracking parameters", () => {
    for (const company of companies) {
      for (const link of [company.optOutUrl, company.privacyRightsUrl]) {
        if (!link) continue;
        const url = new URL(link);
        expect(url.username + url.password, company.id).toBe("");
        expect(url.search, company.id).not.toMatch(/utm_|gclid|fbclid/i);
      }
    }
  });

  it("carries the project's source and license on every company", () => {
    for (const company of companies) {
      expect(company.sources).toEqual([
        { source: "kickrocks-companies", license: "PolyForm-Noncommercial-1.0.0" },
      ]);
    }
  });

  it("shares no id or domain with a broker, because targets of both kinds live in one id space", () => {
    const brokers = buildDataset(loadPinnedIds()).brokers;
    const brokerIds = new Set(brokers.map((broker) => broker.id));
    const brokerDomains = new Set(brokers.map((broker) => broker.domain));
    expect(companies.filter((company) => brokerIds.has(company.id)).map((c) => c.id)).toEqual([]);
    expect(
      companies.filter((company) => brokerDomains.has(company.domain)).map((c) => c.domain),
    ).toEqual([]);
  });

  it("has no em dash anywhere", () => {
    expect(readFileSync(file, "utf8")).not.toContain("\u2014");
  });

  it("is sorted by id so reviews of changes stay small", () => {
    const ids = companies.map((company) => company.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });
});
