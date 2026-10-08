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
  privacyRightsUrl: null,
  searchUrl: null,
  contactMethod: "form",
  requiresId: false,
  requirements: [],
  priority: "normal",
  needsRecord: false,
  californiaRegistered: false,
  difficulty: "easy",
  difficultyReasons: ["email", "no_record_needed"],
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

  it("keeps a single-page portal usable as the visitor moves through its screens", () => {
    const ekata = scoped(
      "https://www.mastercard.us/public/my-data/dgr-public/personal-data-request.html?locale=en-us&region=NAM#/ekata/request/personalinfo",
    );
    const screen = (route: string) =>
      `https://www.mastercard.us/public/my-data/dgr-public/personal-data-request.html?locale=en-us&region=NAM#/${route}`;
    expect(withinSites(screen("ekata/request/personalinfo"), ekata)).toBe(true);
    expect(withinSites(screen("ekata/request/verify"), ekata)).toBe(true);
    expect(withinSites(screen("ekata"), ekata)).toBe(true);
    expect(withinSites(screen("other-company/request/personalinfo"), ekata)).toBe(false);
  });

  it("goes through the tenant's own segment of a route fragment and no further", () => {
    const own = "https://crexi.bigidprivacy.cloud/consumer/#/EnSBtJyXmT/Form-hajoaIUvXqIGKFJ";
    const sites = scoped(own);
    expect(withinSites("https://crexi.bigidprivacy.cloud/consumer/#/EnSBtJyXmT/Done", sites)).toBe(
      true,
    );
    expect(withinSites("https://crexi.bigidprivacy.cloud/consumer/#/o2TCsG9LJ7", sites)).toBe(
      false,
    );
  });

  it("ignores a tracking fragment, which says nothing about whose page it is", () => {
    const own =
      "https://privacyportal.onetrust.com/webform/9bbdeb31-9ca4-4397-b421-b165438ad177/1ca01042-21a7-4307-8b42-a6c7439c9685#xd_co_f=NjJjZjJhZTUtN2I3Yy00NmNkLTlhYTAtYmM2OWQ1N2Y3MGFk~";
    const sites = scoped(own);
    expect(sites.pages[0]?.fragment).toBeUndefined();
    expect(withinSites(own, sites)).toBe(true);
    expect(
      withinSites(
        "https://privacyportal.onetrust.com/webform/9bbdeb31-9ca4-4397-b421-b165438ad177/1ca01042-21a7-4307-8b42-a6c7439c9685#xd_co_f=b3RoZXI~",
        sites,
      ),
    ).toBe(true);
    expect(
      withinSites(
        "https://privacyportal.onetrust.com/webform/00000000-0000-0000-0000-000000000000/1ca01042-21a7-4307-8b42-a6c7439c9685",
        sites,
      ),
    ).toBe(false);
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
    const sites = scoped("https://portal.test/dsar/form?org=7#/dsr/1b319101");
    expect(describeSites(sites)).toContain("portal.test/dsar/form?org=7#/dsr/1b319101");
  });
});

interface DatasetBroker {
  id: string;
  domain: string;
  website: string | null;
  optOutUrl: string | null;
  privacyRightsUrl: string | null;
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
    const present = (urls: (string | null)[]) => urls.filter((url): url is string => url !== null);
    const urlsOf = (broker: DatasetBroker) => present([broker.optOutUrl, broker.searchUrl]);
    const everyUrl = brokers.flatMap((broker) => urlsOf(broker).map((url) => ({ broker, url })));
    const leaks: string[] = [];
    let withPages = 0;
    for (const broker of brokers) {
      const sites = allowedSitesFor(broker as unknown as TargetSummary);
      if (sites.pages.length === 0) continue;
      withPages += 1;
      const own = new Set(
        present([...urlsOf(broker), broker.privacyRightsUrl]).map((url) => new URL(url).href),
      );
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
