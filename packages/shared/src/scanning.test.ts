import { describe, expect, it } from "vitest";
import {
  EgressPatch,
  isCoolingDown,
  isQuietHour,
  MAX_RETRY_AFTER_SECONDS,
  ProxyUrl,
  parseRetryAfter,
  pushbackKindForStatus,
  registrableDomain,
  ScanningSettings,
  SiteObservation,
  siteOwnerKey,
} from "./scanning.js";

describe("ScanningSettings", () => {
  it("defaults to a conservative pace", () => {
    expect(ScanningSettings.parse({})).toEqual({
      minGapMinutes: 20,
      gapJitterPercent: 50,
      dailyCapPerSite: 6,
      hourlyCapTotal: 12,
      dailyCapTotal: 60,
      quietStartHour: 23,
      quietEndHour: 7,
      reuseHours: 24,
      backoffBaseHours: 6,
      backoffMaxHours: 168,
      breakerThreshold: 3,
    });
  });

  it("refuses a breaker that opens on the first pushback", () => {
    expect(ScanningSettings.safeParse({ breakerThreshold: 1 }).success).toBe(false);
  });
});

describe("parseRetryAfter", () => {
  const now = new Date("2026-10-07T12:00:00.000Z");

  it("reads seconds", () => {
    expect(parseRetryAfter("120", now)).toBe(120);
  });

  it("reads an HTTP date as seconds from now", () => {
    expect(parseRetryAfter("Wed, 07 Oct 2026 13:00:00 GMT", now)).toBe(3600);
  });

  it("ignores a date in the past, nonsense, and a missing header", () => {
    expect(parseRetryAfter("Wed, 07 Oct 2026 11:00:00 GMT", now)).toBeUndefined();
    expect(parseRetryAfter("soon", now)).toBeUndefined();
    expect(parseRetryAfter("0", now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });

  it("does not believe a wait longer than a week", () => {
    expect(parseRetryAfter("99999999", now)).toBe(MAX_RETRY_AFTER_SECONDS);
  });
});

describe("pushbackKindForStatus", () => {
  it("names the three statuses that mean slow down", () => {
    expect(pushbackKindForStatus(429)).toBe("rate_limited");
    expect(pushbackKindForStatus(403)).toBe("forbidden");
    expect(pushbackKindForStatus(503)).toBe("unavailable");
    expect(pushbackKindForStatus(200)).toBeNull();
    expect(pushbackKindForStatus(404)).toBeNull();
  });
});

describe("site owners", () => {
  it("reduces a host to its registrable domain", () => {
    expect(registrableDomain("www.spokeo.com")).toBe("spokeo.com");
    expect(registrableDomain("a.b.example.co.uk")).toBe("example.co.uk");
    expect(registrableDomain("localhost")).toBe("localhost");
  });

  it("uses the owner group the dataset names, whatever the domain and the mail say", () => {
    const keys = ["intelius.com", "www.truthfinder.com", "instantcheckmate.com"].map((domain) =>
      siteOwnerKey(domain, ["elsewhere.test"], "peopleconnect.us"),
    );
    expect(new Set(keys)).toEqual(new Set(["peopleconnect.us"]));
  });

  it("groups brokers by the platform their confirmation mail comes from", () => {
    expect(siteOwnerKey("one.test", ["platform-mail.test"])).toBe("platform-mail.test");
    expect(siteOwnerKey("two.test", ["platform-mail.test"])).toBe("platform-mail.test");
    expect(siteOwnerKey("one.test", ["one.test"])).toBe("one.test");
    expect(siteOwnerKey("spokeo.com")).toBe("spokeo.com");
  });
});

describe("ProxyUrl", () => {
  it("accepts an http proxy on the local network", () => {
    expect(ProxyUrl.safeParse("http://10.0.0.100:8888").success).toBe(true);
  });

  it.each([
    "http://user:pass@10.0.0.100:8888",
    "https://proxy.example.test",
    "socks5://10.0.0.100:1080",
  ])("refuses %s", (value) => {
    expect(ProxyUrl.safeParse(value).success).toBe(false);
  });

  it("can be cleared", () => {
    expect(EgressPatch.parse({ proxyUrl: null })).toEqual({ proxyUrl: null });
  });
});

describe("SiteObservation", () => {
  it("carries a pushback with the wait the site asked for", () => {
    expect(
      SiteObservation.parse({
        pushback: { kind: "rate_limited", status: 429, retryAfterSeconds: 600 },
      }),
    ).toEqual({ pushback: { kind: "rate_limited", status: 429, retryAfterSeconds: 600 } });
  });
});

describe("isCoolingDown", () => {
  it("is true for a cooldown or any breaker that is not closed", () => {
    expect(isCoolingDown({ coolingDownUntil: null, breaker: "closed" })).toBe(false);
    expect(isCoolingDown({ coolingDownUntil: "2026-10-08T00:00:00.000Z", breaker: "closed" })).toBe(
      true,
    );
    expect(isCoolingDown({ coolingDownUntil: null, breaker: "half_open" })).toBe(true);
  });
});

describe("isQuietHour", () => {
  it("covers a window that runs past midnight", () => {
    const quiet = [0, 1, 6, 23].map((hour) => isQuietHour(hour, 23, 7));
    const awake = [7, 12, 22].map((hour) => isQuietHour(hour, 23, 7));
    expect(quiet).toEqual([true, true, true, true]);
    expect(awake).toEqual([false, false, false]);
  });

  it("covers a window inside one day", () => {
    expect(isQuietHour(13, 12, 14)).toBe(true);
    expect(isQuietHour(14, 12, 14)).toBe(false);
  });

  it("is off when the start and the end are the same hour", () => {
    expect(isQuietHour(3, 0, 0)).toBe(false);
  });
});
