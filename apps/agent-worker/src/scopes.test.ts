import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { TargetSummary } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { allowedSitesFor, describeSites, withinSites } from "./domains.js";

const target = (optOutUrl: string): TargetSummary => ({
  id: "x",
  kind: "broker",
  name: "X",
  category: "marketing",
  domain: "broker.test",
  website: "https://broker.test/",
  optOutUrl,
  searchUrl: null,
  contactMethod: "form",
  requiresId: false,
  requirements: [],
  priority: "normal",
  needsRecord: false,
  californiaRegistered: false,
  retired: false,
});

const scoped = (optOutUrl: string) => allowedSitesFor(target(optOutUrl));

describe("a page on a platform that serves many tenants", () => {
  it.each([
    [
      "https://app.termly.io/dsar/d1321341-0e82-4d8c-afaf-c4940d46c171",
      "https://app.termly.io/dsar/00000000-0000-0000-0000-000000000000",
    ],
    [
      "https://submit-irm.trustarc.com/services/validation/0a80503b-1d56-4d50-a898-4377a0227dab",
      "https://submit-irm.trustarc.com/services/validation/b8d6e704-e5b1-42a0-9f86-bbdec35939a1",
    ],
    [
      "https://forms.monday.com/forms/2e643e95786ac0c2cdf2dca015d20c68?r=use1",
      "https://forms.monday.com/forms/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa?r=use1",
    ],
    [
      "https://app.smartsheet.com/b/form/48a44f05a4644a1f824601e77ad1719d",
      "https://app.smartsheet.com/b/form/ffffffffffffffffffffffffffffffff",
    ],
  ])("covers %s and not a sibling tenant's page", (own, neighbour) => {
    const sites = scoped(own);
    expect(withinSites(own, sites)).toBe(true);
    expect(withinSites(`${own.split("?")[0]}/step-2?r=use1`, sites)).toBe(true);
    expect(withinSites(neighbour, sites)).toBe(false);
  });

  it("requires the identifying query parameters of a portal that names the tenant there", () => {
    const own =
      "https://privacyportal.privacypillar.com/dsar/form?formid=6e6ff4b8&orgid=369c8ff9&propid=64c8904f&status=publish";
    const sites = scoped(own);
    expect(withinSites(own, sites)).toBe(true);
    expect(
      withinSites(
        "https://privacyportal.privacypillar.com/dsar/form?status=publish&propid=64c8904f&orgid=369c8ff9&formid=6e6ff4b8&step=2",
        sites,
      ),
    ).toBe(true);
    expect(
      withinSites(
        "https://privacyportal.privacypillar.com/dsar/form?formid=4106bc86&orgid=3b24c635&propid=d3da91fd&status=publish",
        sites,
      ),
    ).toBe(false);
    expect(withinSites("https://privacyportal.privacypillar.com/dsar/form", sites)).toBe(false);
  });

  it("requires the fragment of a single-page portal that names the tenant there", () => {
    const own = "https://privacy-central.securiti.ai/#/dsr/1b319101-f00c-470f-a7f0-26aa81f057b8";
    const sites = scoped(own);
    expect(withinSites(own, sites)).toBe(true);
    expect(withinSites(`${own}/thanks`, sites)).toBe(true);
    expect(withinSites("https://privacy-central.securiti.ai/#/dsr/other-tenant", sites)).toBe(
      false,
    );
    expect(withinSites("https://privacy-central.securiti.ai/", sites)).toBe(false);
    expect(withinSites(`${own}9`, sites)).toBe(false);
  });

  it("uses the folder only when the address itself ends in a slash", () => {
    const sites = scoped("https://privacy.vendor.test/center/");
    expect(withinSites("https://privacy.vendor.test/center/form", sites)).toBe(true);
    expect(withinSites("https://privacy.vendor.test/other/", sites)).toBe(false);
  });

  it("keeps a Google Form's own page and the page that receives it, and ignores tracking parameters", () => {
    const sites = scoped("https://docs.google.com/forms/d/e/ABC123/viewform?usp=send_form");
    expect(withinSites("https://docs.google.com/forms/d/e/ABC123/formResponse", sites)).toBe(true);
    expect(
      withinSites("https://docs.google.com/forms/d/e/ABC123/viewform?utm_source=x", sites),
    ).toBe(true);
    expect(withinSites("https://docs.google.com/forms/d/e/OTHER/viewform", sites)).toBe(false);
  });

  it("names the required parameters and fragment to the model", () => {
    const sites = scoped("https://portal.test/dsar/form?org=7#/dsr/9");
    expect(describeSites(sites)).toContain("portal.test/dsar/form?org=7#/dsr/9");
  });
});

interface DatasetBroker {
  id: string;
  domain: string;
  website: string | null;
  optOutUrl: string | null;
  searchUrl: string | null;
}

const datasetFile = fileURLToPath(
  new URL("../../../packages/brokers/data/generated/brokers.json", import.meta.url),
);

describe("the generated broker dataset", () => {
  it("has no page scope that admits another tenant's opt-out page", () => {
    expect(existsSync(datasetFile), "run pnpm data:build first").toBe(true);
    const brokers = (JSON.parse(readFileSync(datasetFile, "utf8")) as { brokers: DatasetBroker[] })
      .brokers;
    const urlsOf = (broker: DatasetBroker) =>
      [broker.optOutUrl, broker.searchUrl].filter((url): url is string => url !== null);
    const everyUrl = brokers.flatMap((broker) => urlsOf(broker).map((url) => ({ broker, url })));
    const leaks: string[] = [];
    let withPages = 0;
    for (const broker of brokers) {
      const sites = allowedSitesFor(broker as unknown as TargetSummary);
      if (sites.pages.length === 0) continue;
      withPages += 1;
      const own = new Set(urlsOf(broker).map((url) => new URL(url).href));
      for (const other of everyUrl) {
        if (other.broker === broker || own.has(new URL(other.url).href)) continue;
        if (withinSites(other.url, { domains: sites.domains, pages: [] })) continue;
        if (withinSites(other.url, sites)) leaks.push(`${broker.id} admits ${other.url}`);
      }
    }
    expect(withPages).toBeGreaterThan(50);
    expect(leaks).toEqual([]);
  });
});
