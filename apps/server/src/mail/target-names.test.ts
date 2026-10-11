import { describe, expect, it } from "vitest";
import { addressIsTarget, mentionsTarget, namesOf, namesRequest } from "./target-names.js";

function target(overrides: Partial<Parameters<typeof namesOf>[0]> = {}) {
  return {
    targetId: "spokeo",
    targetName: "Spokeo",
    targetDomain: "spokeo.com",
    replyDomains: ["spokeo.com"],
    curatedReplyDomains: [],
    replyAddresses: [],
    ...overrides,
  };
}

describe("namesOf", () => {
  it("holds the name, the lead label of each domain and the owner group", () => {
    const intelius = target({
      targetId: "intelius",
      targetName: "Intelius",
      targetDomain: "intelius.com",
      curatedReplyDomains: ["peopleconnect.us"],
      brands: ["peopleconnect.us"],
    });
    expect(namesOf(intelius).sort()).toEqual(["intelius", "peopleconnect"]);
  });

  it("drops the ending of a legal name and splits a parenthesised brand", () => {
    expect(
      namesOf(target({ targetName: "Lead Intelligence Inc.", targetDomain: "x.test" })),
    ).toEqual(expect.not.arrayContaining(["lead intelligence inc"]));
    expect(
      namesOf(target({ targetName: "Chase (JPMorgan Chase)", targetDomain: "chase.com" })),
    ).toEqual(expect.arrayContaining(["chase", "jpmorgan chase"]));
    expect(
      namesOf(target({ targetName: "The Walt Disney Company", targetDomain: "d.test" })),
    ).toContain("walt disney");
  });

  it("leaves out a name that is only words many targets share", () => {
    const generic = target({ targetName: "Data Solutions Group LLC", targetDomain: "data.test" });
    expect(namesOf(generic)).toEqual([]);
  });

  it("keeps a curated alias even when its words are common", () => {
    expect(namesOf(target({ brands: ["Free Data Services"] }))).toContain("free data services");
  });
});

describe("mentionsTarget", () => {
  it("matches whole words, ignoring case and accents", () => {
    expect(mentionsTarget(target(), "Hello from SPOKEO.")).toBe(true);
    expect(mentionsTarget(target({ targetName: "Équifax" }), "Equifax Privacy")).toBe(true);
    expect(mentionsTarget(target({ targetName: "Equifax" }), "Équifax Privacy")).toBe(true);
  });

  it("does not match a name inside a longer word", () => {
    expect(mentionsTarget(target(), "Spokeoish things")).toBe(false);
    expect(mentionsTarget(target(), "unspokeo")).toBe(false);
  });

  it("matches a name written together, apart or with a dash", () => {
    const bestBuy = target({ targetName: "Best Buy", targetDomain: "bestbuy.com" });
    expect(
      ["Best Buy", "BestBuy", "Best-Buy"].map((text) => mentionsTarget(bestBuy, text)),
    ).toEqual([true, true, true]);
  });

  it("matches the domain, a subdomain of it, and a curated sister domain", () => {
    const intelius = target({
      targetDomain: "intelius.com",
      curatedReplyDomains: ["peopleconnect.us"],
    });
    expect(mentionsTarget(intelius, "see https://www.intelius.com/optout")).toBe(true);
    expect(mentionsTarget(intelius, "write to privacy@mail.peopleconnect.us")).toBe(true);
    expect(mentionsTarget(intelius, "see notintelius.com")).toBe(false);
  });

  it("ignores a generic word that many targets share", () => {
    const generic = target({
      targetName: "Global Data Marketing Inc",
      targetDomain: "gdm.example",
    });
    expect(mentionsTarget(generic, "Your global data marketing preferences")).toBe(false);
  });

  it("never matches the empty text", () => {
    expect(mentionsTarget(target(), "")).toBe(false);
  });
});

describe("addressIsTarget", () => {
  it("counts the domain, its subdomains and listed addresses, and never a shared mail host", () => {
    expect(addressIsTarget("a@spokeo.com", target())).toBe(true);
    expect(addressIsTarget("a@news.spokeo.com", target())).toBe(true);
    expect(addressIsTarget("a@elsewhere.test", target())).toBe(false);
    const onGmail = target({ targetDomain: "gmail.com", replyDomains: ["gmail.com"] });
    expect(addressIsTarget("someone@gmail.com", onGmail)).toBe(false);
    expect(
      addressIsTarget("owner@gmail.com", { ...onGmail, replyAddresses: ["owner@gmail.com"] }),
    ).toBe(true);
  });
});

describe("namesRequest", () => {
  const mail = { subject: "Hi", fromName: null, fromAddress: "x@elsewhere.test", body: "" };

  it.each([
    ["the subject", { subject: "Your Spokeo request" }],
    ["the sender's display name", { fromName: "Spokeo Privacy" }],
    ["the body", { body: "Thanks,\nThe Spokeo team" }],
    ["the sender's domain", { fromAddress: "x@spokeo.com" }],
  ])("is named by %s", (_where, change) => {
    expect(namesRequest(target(), { ...mail, ...change })).toBe(true);
  });

  it("is not named by mail that mentions nothing of the target", () => {
    expect(namesRequest(target(), mail)).toBe(false);
  });
});
