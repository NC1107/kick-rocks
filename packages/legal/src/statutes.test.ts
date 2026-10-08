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
      /^publications\.tnsosfiles\.com$/,
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

  it("covers all 24 comprehensive laws enacted by 2026-10-07, the Delete Act, and Nevada", () => {
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
    expect(
      STATUTES.filter((statute) => statute.kind === "data_broker").map((statute) => statute.id),
    ).toEqual(["ca-delete-act", "nv-nrs-603a"]);
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

  it("cites the enacted New Jersey chapter and sections, not the bill number", () => {
    const comprehensive = STATUTES.find((statute) => statute.id === "nj-njdpa");
    expect(comprehensive?.citation).toContain("56:8-166.4");
    expect(comprehensive?.citation).toContain("P.L. 2023, c. 266");
    const broker = BROKER_REGISTRATION_LAWS.find((law) => law.state === "NJ");
    expect(broker?.citation).toBe("P.L. 2026, c. 25 (N.J.S.A. 56:8-166.20 to 56:8-166.24)");
    expect(broker?.citation).not.toContain("A5328");
    expect(broker?.sourceUrl).toBe("https://pub.njleg.state.nj.us/Bills/2026/PL26/25_.PDF");
  });

  it("cites the Nevada operator and data broker sections and keeps the verified request limit", () => {
    const nevada = STATUTES.find((statute) => statute.id === "nv-nrs-603a");
    expect(nevada?.citation).toBe("Nev. Rev. Stat. 603A.345 and 603A.346");
    expect(nevada?.rights).toEqual(["opt_out"]);
    expect(nevada?.responseDays).toBe(60);
    expect(nevada?.notes).toContain("603A.337");
    expect(traitsOf("nv-nrs-603a").optOutAuthRule).toBeNull();
  });

  it("cites 1798.99.86 for DROP and limits the CCPA deletion right to data collected from the consumer", () => {
    expect(STATUTES.find((s) => s.id === "ca-delete-act")?.notes).toContain("1798.99.86");
    expect(STATUTES.find((s) => s.id === "ca-ccpa")?.notes).toContain("1798.105(a)");
    expect(traitsOf("ca-ccpa").deleteScope).toBe("provided");
  });

  it("names the rule behind every opt-out authentication claim and makes none for Colorado", () => {
    const withRule = STATUTES.filter((s) => traitsOf(s.id).optOutAuthRule !== null);
    expect(withRule.map((s) => s.state).sort()).toEqual([
      "AL",
      "CA",
      "CT",
      "DE",
      "MD",
      "MN",
      "MT",
      "NH",
      "NJ",
      "OR",
      "RI",
      "VT",
    ]);
    for (const statute of withRule) {
      expect(statute.kind, statute.id).toBe("comprehensive");
      expect(traitsOf(statute.id).optOutAuthRule, statute.id).toMatch(/\d/);
    }
    expect(traitsOf("co-cpa").optOutAuthRule).toBeNull();
  });

  it("cites the Maryland sections at 14-47xx and the Tennessee act as enacted", () => {
    expect(STATUTES.find((s) => s.id === "md-modpa")?.citation).toBe(
      "Md. Code, Com. Law 14-4701 et seq.",
    );
    expect(traitsOf("md-modpa").optOutAuthRule).toBe("Md. Code, Com. Law 14-4705(e)(6)");
    expect(STATUTES.find((s) => s.id === "tn-tipa")?.sourceUrl).toBe(
      "https://publications.tnsosfiles.com/acts/113/pub/pc0408.pdf",
    );
  });

  it("keeps Louisiana out of the opt-out authentication rules and names the Alabama and Vermont ones", () => {
    expect(traitsOf("la-ldpa").optOutAuthRule).toBeNull();
    expect(traitsOf("al-apdpa").optOutAuthRule).toBe("Ala. Act 2026-552, sec. 5(d)(4)");
    expect(traitsOf("vt-vdposa").optOutAuthRule).toBe("9 V.S.A. 2415d(c)(4)(B)");
  });

  it("never writes an em dash", () => {
    expect(JSON.stringify([STATUTES, BROKER_REGISTRATION_LAWS])).not.toContain(EM_DASH);
  });
});

describe("broker registration laws", () => {
  it("are valid, sourced, and none is a basis for an email request", () => {
    expect(BROKER_REGISTRATION_LAWS.map((law) => law.state).sort()).toEqual([
      "CT",
      "NJ",
      "OR",
      "TX",
      "VT",
    ]);
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
