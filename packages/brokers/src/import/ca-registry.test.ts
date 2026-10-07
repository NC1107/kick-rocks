import { describe, expect, it } from "vitest";
import { parseCaRegistry } from "./ca-registry.js";

function row(values: Record<number, string>): string {
  const cells = Array.from({ length: 67 }, (_, i) => values[i] ?? "");
  return cells.map((c) => `"${c.replace(/"/g, '""')}"`).join(",");
}

const header1 = row({ 1: "If not answered by DB, do not surface in website." });
const header2 = row({ 0: "Data broker name:", 2: "Data broker primary website:" });

const explorium = row({
  0: "Explorium Inc.",
  2: "https://www.explorium.ai",
  3: "privacy@explorium.ai",
  11: "No",
  12: "Yes",
  14: "https://www.explorium.ai/platform-privacy-policy/",
  15: "Yes",
  19: "No",
  35: "10",
  36: "10",
  38: "0",
  39: "5",
  53: "1,200",
  54: "1,150",
  56: "0",
  57: "3",
});

const bareDomain = row({
  0: "Bare Domain Co",
  2: "baredomain.example",
  3: "privacy@baredomain.example; legal@baredomain.example",
});

const nameless = row({ 2: "https://ignored.example" });

const csv = [header1, header2, explorium, bareDomain, nameless].join("\n");

describe("parseCaRegistry", () => {
  const brokers = parseCaRegistry(csv);

  it("skips both header rows and nameless rows", () => {
    expect(brokers.map((b) => b.id)).toEqual(["explorium-inc", "bare-domain-co"]);
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
    });
    expect(ex?.metrics).toMatchObject({
      year: 2023,
      deleteReceived: 10,
      deleteCompliedWhole: 10,
      deleteMedianDays: 5,
      optOutReceived: 1200,
      optOutCompliedWhole: 1150,
      optOutMedianDays: 3,
    });
  });

  it("adds a scheme to bare domains and keeps the first of several emails", () => {
    const bare = brokers[1];
    expect(bare?.website).toBe("https://baredomain.example");
    expect(bare?.privacyEmail).toBe("privacy@baredomain.example");
  });
});
