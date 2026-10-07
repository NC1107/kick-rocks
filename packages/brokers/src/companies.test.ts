import { COMPANY_DATASET_LICENSE } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { hasCompanyDataset, loadCompanies, loadCompanyDataset } from "./index.js";

describe("loadCompanyDataset", () => {
  it("returns a valid dataset even before a company list exists", () => {
    const dataset = loadCompanyDataset();
    expect(Array.isArray(dataset.companies)).toBe(true);
    expect(dataset.license).toBe(COMPANY_DATASET_LICENSE);
    expect(loadCompanies()).toEqual(dataset.companies);
  });

  it("tells a missing list apart from an empty one", () => {
    // An empty answer would make a sync retire every company, so callers ask first.
    expect(typeof hasCompanyDataset()).toBe("boolean");
  });
});
