import { describe, expect, it } from "vitest";
import { parseCaRegistry } from "./ca-registry.js";

const HEADERS = [
  "Data broker name:",
  "Doing Business As (DBA), if applicable:",
  "Data broker primary website:",
  "Data broker primary contact email address:",
  "Data broker's primary website that contains details on how consumers can exercise their CA Consumer Privacy rights:",
  "Data broker collects personal information of minors:",
  "Data broker collects consumers' precise geolocation",
  "Data broker collects consumers’ reproductive health care data:",
  "The data broker or any of its subsidiaries is regulated by the federal Fair Credit Reporting Act",
  "If the data broker or its subsidiaries are regulated by the FCRA, describe the types of personal information covered",
  "The data broker or any of its subsidiaries is regulated by the Gramm‑Leach‑Bliley Act (GLBA) and implementing regulations",
  "If the data broker or its subsidiaries are regulated by the GLBA, describe the types of personal information covered",
  "The data broker or any of its subsidiaries is regulated by the California Insurance Information and Privacy Protection Act (IIPPA)",
  "The data broker or any of its subsidiaries is regulated by the California Confidentiality of Medical Information Act (CMIA)",
  "The data broker or its subsidiaries are regulated by the HIPAA privacy, security, and breach‑notification rules",
  "Requests to delete - Total requests received",
  "Requests to delete - Total requests received - Complied in whole",
  "Requests to delete - Total requests received - Complied in part",
  "Requests to delete - Total requests received - Denied",
  "Requests to delete - The number of days to respond substantively to a request to delete in 2024 - Mean",
  "Requests to delete - The number of days to respond substantively to a request to delete in 2024 - Median",
  "Requests to opt out of sale or sharing - Total requests received",
  "Requests to opt out of sale or sharing - Total requests received - Complied in whole",
  "Requests to opt out of sale or sharing - Total requests received - Denied",
  "Requests to opt out of sale or sharing - The number of days to respond substantively to a request to know in 2024 - Median",
] as const;

type Header = (typeof HEADERS)[number];

function csvOf(headers: readonly string[], rows: readonly Partial<Record<Header, string>>[]) {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
  return [
    `﻿${headers.map(quote).join(",")}`,
    ...rows.map((values) =>
      headers.map((header) => quote(values[header as Header] ?? "")).join(","),
    ),
  ].join("\n");
}

const explorium: Partial<Record<Header, string>> = {
  "Data broker name:": "Explorium Inc.",
  "Data broker primary website:": "https://www.explorium.ai",
  "Data broker primary contact email address:": "privacy@explorium.ai",
  "Data broker collects personal information of minors:": "No",
  "Data broker collects consumers' precise geolocation": "Yes",
  "Data broker's primary website that contains details on how consumers can exercise their CA Consumer Privacy rights:":
    "https://www.explorium.ai/platform-privacy-policy/",
  "The data broker or any of its subsidiaries is regulated by the federal Fair Credit Reporting Act":
    "Yes",
  "If the data broker or its subsidiaries are regulated by the FCRA, describe the types of personal information covered":
    "Yes, this is prose and not a flag",
  "The data broker or any of its subsidiaries is regulated by the Gramm‑Leach‑Bliley Act (GLBA) and implementing regulations":
    "No",
  "Requests to delete - Total requests received": "10",
  "Requests to delete - Total requests received - Complied in whole": "10",
  "Requests to delete - Total requests received - Denied": "0",
  "Requests to delete - The number of days to respond substantively to a request to delete in 2024 - Mean":
    "9",
  "Requests to delete - The number of days to respond substantively to a request to delete in 2024 - Median":
    "5",
  "Requests to opt out of sale or sharing - Total requests received": "1,200",
  "Requests to opt out of sale or sharing - Total requests received - Complied in whole": "1,150",
  "Requests to opt out of sale or sharing - Total requests received - Denied": "0",
  "Requests to opt out of sale or sharing - The number of days to respond substantively to a request to know in 2024 - Median":
    "3",
};

const bareDomain: Partial<Record<Header, string>> = {
  "Data broker name:": "Bare Domain Co",
  "Data broker primary website:": "baredomain.example",
  "Data broker primary contact email address:":
    "privacy@baredomain.example; legal@baredomain.example",
};

const nameless: Partial<Record<Header, string>> = {
  "Data broker primary website:": "https://ignored.example",
};

// The registry puts every site a broker runs in one cell, separated by semicolons and line breaks.
const manySites: Partial<Record<Header, string>> = {
  "Data broker name:": "Many Sites LLC",
  "Data broker primary website:": "https://www.first.example;\nhttps://second.example",
  "Data broker primary contact email address:": "privacy@first.example",
  "Data broker's primary website that contains details on how consumers can exercise their CA Consumer Privacy rights:":
    "https://www.first.example/privacy;\nhttps://second.example/privacy",
};

const csv = csvOf(HEADERS, [explorium, bareDomain, nameless, manySites]);

describe("parseCaRegistry", () => {
  const brokers = parseCaRegistry(csv);

  it("skips nameless rows", () => {
    expect(brokers.map((b) => b.id)).toEqual(["explorium-inc", "bare-domain-co", "many-sites-llc"]);
  });

  it("extracts contact, flags, regimes and metrics", () => {
    const ex = brokers[0];
    expect(ex).toMatchObject({
      category: "registered-broker",
      domain: "explorium.ai",
      privacyEmail: "privacy@explorium.ai",
      privacyRightsUrl: "https://www.explorium.ai/platform-privacy-policy/",
      contactMethod: "both",
      collectsMinors: false,
      collectsGeolocation: true,
      collectsReproductiveHealth: null,
      regulatedBy: ["fcra"],
      sources: [
        { source: "ca-registry-2026", license: "public-record", upstreamId: "Explorium Inc." },
      ],
    });
    expect(ex?.metrics).toEqual({
      year: 2024,
      deleteReceived: 10,
      deleteCompliedWhole: 10,
      deleteDenied: 0,
      deleteMedianDays: 5,
      optOutReceived: 1200,
      optOutCompliedWhole: 1150,
      optOutDenied: 0,
      optOutMedianDays: 3,
    });
  });

  it("finds columns by header, wherever they sit", () => {
    const shuffled = [...HEADERS].reverse();
    const [explorer] = parseCaRegistry(csvOf(shuffled, [explorium]));
    expect(explorer).toMatchObject({ domain: "explorium.ai", regulatedBy: ["fcra"] });
    expect(explorer?.metrics?.deleteMedianDays).toBe(5);
  });

  it("adds a scheme to bare domains and takes the first address of a list", () => {
    const bare = brokers[1];
    expect(bare?.website).toBe("https://baredomain.example");
    expect(bare?.privacyEmail).toBe("privacy@baredomain.example");
  });

  it("reads the first site of a multi-site cell as the broker's own and keeps the rest as a note", () => {
    const many = brokers[2];
    expect(many).toMatchObject({
      domain: "first.example",
      website: "https://www.first.example",
      privacyRightsUrl: "https://www.first.example/privacy",
      notes: "Other sites: https://second.example",
    });
  });

  it("refuses a file whose columns it cannot find", () => {
    expect(() => parseCaRegistry(csvOf(HEADERS.slice(0, 5), [explorium]))).toThrow(/no column for/);
    expect(() => parseCaRegistry("")).toThrow(/empty/);
  });

  it("refuses a file that does not say which year its metrics cover", () => {
    const undated = HEADERS.map((header) => header.replace(" in 2024", ""));
    expect(() => parseCaRegistry(csvOf(undated, [explorium]))).toThrow(/which year/);
  });

  it("reads the committed 2026 registry", async () => {
    const { readPinnedUpstream } = await import("../upstream.js");
    const real = parseCaRegistry(
      readPinnedUpstream("ca-registry-2026.csv", { source: "ca-registry.source.json" }),
    );
    expect(real.length).toBeGreaterThan(550);
    expect(real.every((broker) => broker.metrics?.year === 2024)).toBe(true);
    expect(real.some((broker) => broker.regulatedBy.length > 0)).toBe(true);
  });
});
