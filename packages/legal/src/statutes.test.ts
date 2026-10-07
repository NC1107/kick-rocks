import { StateCode, Statute, US_STATES } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { BROKER_REGISTRATION_LAWS, BrokerRegistrationLaw } from "./broker-laws.js";
import { listJurisdictions } from "./index.js";
import { STATUTES, traitsOf } from "./statutes.js";

const EM_DASH = String.fromCharCode(0x2014);

describe("statute data", () => {
  it("has a valid, sourced entry for every statute", () => {
    for (const statute of STATUTES) {
      const parsed = Statute.safeParse(statute);
      expect(parsed.success, `${statute.id}: ${parsed.error?.message}`).toBe(true);
      expect(statute.sourceUrl, statute.id).toMatch(/^https:\/\//);
      expect(Number.isNaN(Date.parse(statute.effectiveDate)), statute.id).toBe(false);
      expect(statute.effectiveDate, statute.id).toBe(
        new Date(statute.effectiveDate).toISOString().slice(0, 10),
      );
    }
  });

  it("points every source at a government site or a legislature host", () => {
    const allowed = [
      /\.gov$/,
      /\.state\.[a-z]{2}\.us$/,
      /^(www\.)?cga\.ct\.gov$/,
      /^(www\.)?legis\.iowa\.gov$/,
      /^(www\.)?oregonlegislature\.gov$/,
      /^(www\.)?revisor\.mn\.gov$/,
      /^law\.lis\.virginia\.gov$/,
      /^delcode\.delaware\.gov$/,
      /^le\.utah\.gov$/,
      /^iga\.in\.gov$/,
      /^(www\.)?flsenate\.gov$/,
      /^apps\.legislature\.ky\.gov$/,
      /^mca\.legmt\.gov$/,
      /^nebraskalegislature\.gov$/,
      /^pub\.njleg\.state\.nj\.us$/,
      /^mgaleg\.maryland\.gov$/,
      /^(www\.)?capitol\.tn\.gov$/,
      /^webserver\.rilegislature\.gov$/,
      /^legis\.la\.gov$/,
      /^legislature\.vermont\.gov$/,
      /^alison\.legislature\.state\.al\.us$/,
      /^leg\.colorado\.gov$/,
      /^gc\.nh\.gov$/,
      /^leginfo\.legislature\.ca\.gov$/,
      /^privacy\.ca\.gov$/,
      /^statutes\.capitol\.texas\.gov$/,
    ];
    for (const record of [...STATUTES, ...BROKER_REGISTRATION_LAWS]) {
      const host = new URL(record.sourceUrl).hostname;
      expect(
        allowed.some((pattern) => pattern.test(host)),
        `${record.id} cites ${host}`,
      ).toBe(true);
    }
  });

  it("has unique ids that start with the state they belong to", () => {
    const ids = STATUTES.map((statute) => statute.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const statute of STATUTES) {
      expect(statute.id.startsWith(`${statute.state.toLowerCase()}-`), statute.id).toBe(true);
    }
  });

  it("records traits for every statute", () => {
    for (const statute of STATUTES) {
      expect(() => traitsOf(statute.id), statute.id).not.toThrow();
    }
    expect(() => traitsOf("zz-unknown")).toThrow();
  });

  it("covers all 24 comprehensive laws enacted by 2026-10-07 and the Delete Act", () => {
    const comprehensive = STATUTES.filter((statute) => statute.kind === "comprehensive");
    expect(comprehensive.map((statute) => statute.state).sort()).toEqual([
      "AL",
      "CA",
      "CO",
      "CT",
      "DE",
      "FL",
      "IA",
      "IN",
      "KY",
      "LA",
      "MD",
      "MN",
      "MT",
      "NE",
      "NH",
      "NJ",
      "OK",
      "OR",
      "RI",
      "TN",
      "TX",
      "UT",
      "VA",
      "VT",
    ]);
    expect(STATUTES.filter((statute) => statute.kind === "data_broker")).toHaveLength(1);
  });

  it("gives the Delete Act the DROP platform and no other statute a platform", () => {
    for (const statute of STATUTES) {
      expect(statute.platform === null, statute.id).toBe(statute.id !== "ca-delete-act");
    }
    expect(STATUTES.find((s) => s.id === "ca-delete-act")?.platform?.url).toBe(
      "https://privacy.ca.gov/drop/",
    );
  });

  it("uses the day-count each statute sets", () => {
    const days = Object.fromEntries(
      STATUTES.map((s) => [s.id, `${s.responseDays}+${s.extensionDays}`]),
    );
    expect(days["ia-icdpa"]).toBe("90+45");
    expect(days["fl-fdbr"]).toBe("45+15");
    expect(days["va-vcdpa"]).toBe("45+45");
  });

  it("never writes an em dash", () => {
    expect(JSON.stringify([STATUTES, BROKER_REGISTRATION_LAWS])).not.toContain(EM_DASH);
  });
});

describe("broker registration laws", () => {
  it("are valid, sourced, and give no request right", () => {
    expect(BROKER_REGISTRATION_LAWS.map((law) => law.state).sort()).toEqual(["OR", "TX", "VT"]);
    for (const law of BROKER_REGISTRATION_LAWS) {
      expect(BrokerRegistrationLaw.safeParse(law).success, law.id).toBe(true);
      expect(law.sourceUrl).toMatch(/^https:\/\//);
    }
  });
});

describe("listJurisdictions", () => {
  it("lists all 51 jurisdictions, each with only its own statutes", () => {
    const jurisdictions = listJurisdictions();
    expect(jurisdictions.map((j) => j.state)).toEqual(US_STATES.map((s) => s.code));
    for (const jurisdiction of jurisdictions) {
      expect(StateCode.safeParse(jurisdiction.state).success).toBe(true);
      for (const statute of jurisdiction.statutes) expect(statute.state).toBe(jurisdiction.state);
    }
    expect(jurisdictions.find((j) => j.state === "CA")?.statutes.map((s) => s.id)).toEqual([
      "ca-ccpa",
      "ca-delete-act",
    ]);
    expect(jurisdictions.find((j) => j.state === "WY")?.statutes).toEqual([]);
  });
});
