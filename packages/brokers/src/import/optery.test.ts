import { describe, expect, it } from "vitest";
import { parseOpteryBrokers } from "./optery.js";

const sample = JSON.stringify([
  {
    id: 1,
    title: "Spokeo",
    website: "https://www.spokeo.com/",
    opt_out_url: "https://www.spokeo.com/optout",
    email: "privacy@spokeo.com",
    type: "People Search Site",
    description: "Long text that is not copied.",
  },
  {
    id: 2,
    title: "Lead Co",
    website: "https://leadco.example",
    opt_out_url: "",
    email: "accounting@leadco.example",
    type: "B2B Lead Generation",
  },
  {
    id: 3,
    title: "Other Host Inc",
    website: "https://otherhost.example",
    opt_out_url: "",
    email: "privacy@somebody-else.example",
    type: "Marketing",
  },
  {
    id: 4,
    title: "No Site",
    website: "",
    opt_out_url: "",
    email: "privacy@nosite.example",
    type: "",
  },
  {
    id: 5,
    title: "Spokeo",
    website: "https://spokeo.example",
    opt_out_url: "javascript:alert(1)",
    email: "",
    type: "Phone Directory",
  },
]);

describe("parseOpteryBrokers", () => {
  const brokers = parseOpteryBrokers(sample);

  it("maps fields, derives the contact method and names the source and license", () => {
    expect(brokers[0]).toMatchObject({
      id: "spokeo",
      domain: "spokeo.com",
      category: "people-search",
      privacyEmail: "privacy@spokeo.com",
      optOutUrl: "https://www.spokeo.com/optout",
      contactMethod: "both",
      notes: null,
      sources: [{ source: "optery", license: "CC-BY-NC-SA-4.0", upstreamId: "1" }],
    });
  });

  it("drops a contact that is not a privacy inbox on the broker's own host", () => {
    expect(brokers.find((b) => b.id === "lead-co")).toMatchObject({
      category: "marketing",
      privacyEmail: null,
      contactMethod: "unknown",
    });
    expect(brokers.find((b) => b.id === "other-host-inc")?.privacyEmail).toBeNull();
  });

  it("skips entries without a website and keeps ids unique", () => {
    expect(brokers.map((b) => b.id)).toEqual([
      "spokeo",
      "lead-co",
      "other-host-inc",
      "spokeo-spokeo-example",
    ]);
  });

  it("rejects a link that is not a web URL", () => {
    expect(brokers[3]?.optOutUrl).toBeNull();
    expect(brokers[3]?.category).toBe("people-search");
  });
});
