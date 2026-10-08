import { EgressSettings, ScanningSettings } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  checkEgress,
  checkScanning,
  egressDraftOf,
  SCANNING_FIELDS,
  scanningDraftOf,
} from "./scanning-model.js";

const saved = ScanningSettings.parse({ timeZone: "America/Los_Angeles" });
const savedEgress = EgressSettings.parse({});

describe("checkScanning", () => {
  it("has no patch when nothing changed", () => {
    expect(checkScanning(scanningDraftOf(saved), saved)).toEqual({ errors: {}, patch: {} });
  });

  it("patches only what changed", () => {
    const draft = { ...scanningDraftOf(saved), dailyCapPerSite: "3" };
    expect(checkScanning(draft, saved).patch).toEqual({ dailyCapPerSite: 3 });
  });

  it("patches quiet hours and the daily total, and holds the hour to the clock", () => {
    const draft = {
      ...scanningDraftOf(saved),
      quietStartHour: "22",
      quietEndHour: "6",
      dailyCapTotal: "40",
    };
    expect(checkScanning(draft, saved).patch).toEqual({
      quietStartHour: 22,
      quietEndHour: 6,
      dailyCapTotal: 40,
    });
    expect(checkScanning({ ...draft, quietEndHour: "24" }, saved).errors).toEqual({
      quietEndHour: "Enter 0 to 23.",
    });
  });

  it("explains a value that is not a whole number or out of range", () => {
    const draft = { ...scanningDraftOf(saved), minGapMinutes: "1.5", hourlyCapTotal: "9000" };
    expect(checkScanning(draft, saved).errors).toEqual({
      minGapMinutes: "Enter a whole number.",
      hourlyCapTotal: "Enter 1 to 500.",
    });
  });

  it("allows turning reuse off with zero", () => {
    const draft = { ...scanningDraftOf(saved), reuseHours: "0" };
    expect(checkScanning(draft, saved)).toEqual({ errors: {}, patch: { reuseHours: 0 } });
  });

  it("covers every numeric field the card shows", () => {
    expect(SCANNING_FIELDS.map((field) => field.key).sort()).toEqual(
      Object.keys(scanningDraftOf(saved))
        .filter((key) => key !== "timeZone")
        .sort(),
    );
  });

  it("offers the browser's zone while none is saved, and saves it as the choice", () => {
    const unset = ScanningSettings.parse({});
    const draft = scanningDraftOf(unset, "Europe/Paris");
    expect(draft.timeZone).toBe("Europe/Paris");
    expect(checkScanning(draft, unset).patch).toEqual({ timeZone: "Europe/Paris" });
  });

  it("refuses a time zone that does not exist", () => {
    const draft = { ...scanningDraftOf(saved), timeZone: "Mars/Olympus" };
    expect(checkScanning(draft, saved).errors).toEqual({
      timeZone: "Use a time zone name such as America/Los_Angeles.",
    });
  });
});

describe("checkEgress", () => {
  it("has no patch for the default, which sends nothing through a proxy", () => {
    expect(checkEgress(egressDraftOf(savedEgress), savedEgress)).toEqual({
      errors: {},
      patch: {},
    });
  });

  it("accepts an http proxy and a list of sites, one per line or comma separated", () => {
    const check = checkEgress(
      { proxyUrl: " http://10.0.0.100:8888 ", domains: "Spokeo.com\nintelius.com, whitepages.com" },
      savedEgress,
    );
    expect(check).toEqual({
      errors: {},
      patch: {
        proxyUrl: "http://10.0.0.100:8888",
        domains: ["spokeo.com", "intelius.com", "whitepages.com"],
      },
    });
  });

  it("refuses an address with credentials or the wrong scheme, and a bad site name", () => {
    expect(
      checkEgress({ proxyUrl: "http://user:pw@10.0.0.100:8888", domains: "" }, savedEgress).errors
        .proxyUrl,
    ).toMatch(/without a user name/);
    expect(
      checkEgress({ proxyUrl: "socks5://10.0.0.100", domains: "" }, savedEgress).errors,
    ).toHaveProperty("proxyUrl");
    expect(
      checkEgress({ proxyUrl: "", domains: "not a site!" }, savedEgress).errors.domains,
    ).toMatch(/not a site name/);
  });

  it("clears the proxy when the field is emptied", () => {
    const withProxy = EgressSettings.parse({ proxyUrl: "http://10.0.0.100:8888" });
    expect(checkEgress({ proxyUrl: "", domains: "" }, withProxy).patch).toEqual({ proxyUrl: null });
  });
});
