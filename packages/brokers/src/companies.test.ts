import { describe, expect, it } from "vitest";
import { loadCompanies, loadCompanyDataset } from "./index.js";

describe("loadCompanyDataset", () => {
  it("returns a valid dataset even before a company list exists", () => {
    const dataset = loadCompanyDataset();
    expect(Array.isArray(dataset.companies)).toBe(true);
    expect(loadCompanies()).toEqual(dataset.companies);
  });
});
