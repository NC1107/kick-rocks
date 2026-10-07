import { describe, expect, it } from "vitest";
import { parseEraserBrokers } from "./eraser.js";

const sample = `brokers:
    - id: spokeo
      name: Spokeo
      email: privacy@spokeo.com
      website: https://www.spokeo.com
      opt_out_url: https://www.spokeo.com/optout
      region: us
      category: people-search
    - id: whitepages
      name: Whitepages
      email: ""
      website: https://www.whitepages.com
      opt_out_url: https://www.whitepages.com/suppression-requests
      region: us
      category: people-search
      notes: 'Email bounced; use the form.'
    - id: nowhere
      name: Nowhere Inc
      email: ""
      website: ""
      opt_out_url: ""
      region: us
      category: marketing
    - id: idcheck
      name: ID Check Co
      email: privacy@idcheck.example
      website: https://idcheck.example
      opt_out_url: ""
      region: eu
      category: requires-id
`;

describe("parseEraserBrokers", () => {
  const brokers = parseEraserBrokers(sample);

  it("maps fields and derives the contact method", () => {
    const spokeo = brokers.find((b) => b.id === "spokeo");
    expect(spokeo).toMatchObject({
      domain: "spokeo.com",
      privacyEmail: "privacy@spokeo.com",
      optOutUrl: "https://www.spokeo.com/optout",
      contactMethod: "both",
      category: "people-search",
    });
    expect(spokeo?.sources).toEqual([{ source: "eraser", license: "MIT", upstreamId: "spokeo" }]);
  });

  it("treats an empty email as form-only", () => {
    const wp = brokers.find((b) => b.id === "whitepages");
    expect(wp?.privacyEmail).toBeNull();
    expect(wp?.contactMethod).toBe("form");
    expect(wp?.notes).toBe("Email bounced; use the form.");
  });

  it("drops entries with no way to derive a domain", () => {
    expect(brokers.find((b) => b.id === "nowhere")).toBeUndefined();
  });

  it("flags requires-id brokers and keeps the region", () => {
    const idc = brokers.find((b) => b.id === "idcheck");
    expect(idc?.requiresId).toBe(true);
    expect(idc?.region).toBe("eu");
  });
});
