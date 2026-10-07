import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  COMPANY_DATASET_LICENSE,
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

describe("the company dataset", () => {
  const companies = loadCompanies();

  it("covers at least 75 major consumer companies", () => {
    expect(companies.length).toBeGreaterThanOrEqual(75);
  });

  it("spreads across the consumer categories", () => {
    const categories = new Set(companies.map((company) => company.category));
    for (const category of ["retail", "finance", "telecom", "tech", "media", "travel", "health"]) {
      expect(categories.has(category as never), category).toBe(true);
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

  it("gives every company a way to ask, and states the contact method that way", () => {
    for (const company of companies) {
      const form = company.optOutUrl ?? company.privacyRightsUrl;
      expect(company.privacyEmail !== null || form !== null, company.id).toBe(true);
      expect(company.contactMethod, company.id).toBe(contactMethodFor(company.privacyEmail, form));
    }
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
    expect(readFileSync(file, "utf8")).not.toContain("—");
  });

  it("is sorted by id so reviews of changes stay small", () => {
    const ids = companies.map((company) => company.id);
    expect(ids).toEqual([...ids].sort((a, b) => a.localeCompare(b)));
  });
});
