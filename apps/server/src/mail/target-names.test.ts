import { hasGeneratedDataset, loadBrokers, loadCompanies } from "@kickrocks/brokers";
import { withoutSharedHosts } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  addressIsTarget,
  domainsOf,
  exactNamesOf,
  mentionsTarget,
  namesOf,
  namesRequest,
} from "./target-names.js";

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
    ).toEqual(["jpmorgan chase"]);
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
    const generic = target({ targetName: "Global Data Inc", targetDomain: "gdm.example" });
    expect(mentionsTarget(generic, "Your global data preferences")).toBe(false);
  });

  it('matches a name written with an apostrophe, an ampersand or "and"', () => {
    const macys = target({ targetName: "Macy's", targetDomain: "macys.com" });
    expect(
      ["Macy's", "Macy’s", "macys", "MACY'S Privacy"].map((t) => mentionsTarget(macys, t)),
    ).toEqual([true, true, true, true]);
    const noble = target({ targetName: "Barnes & Noble", targetDomain: "bn.com" });
    expect(
      ["Barnes & Noble", "Barnes and Noble", "barnesandnoble", "BarnesNoble", "Barnes-Noble"].map(
        (t) => mentionsTarget(noble, t),
      ),
    ).toEqual([true, true, true, true, true]);
    const att = target({ targetName: "AT&T", targetDomain: "att.com" });
    expect(["AT&T Privacy", "AT & T", "ATT"].map((t) => mentionsTarget(att, t))).toEqual([
      true,
      true,
      true,
    ]);
    expect(mentionsTarget(att, "look at t-shirts")).toBe(false);
  });

  it("does not name a target by an everyday word of its domain", () => {
    const here = target({
      targetName: "HERE North America LLC",
      targetDomain: "here.com",
      replyDomains: ["here.com"],
    });
    expect(mentionsTarget(here, "Click here to review your account.")).toBe(false);
    expect(mentionsTarget(here, "HERE North America Privacy")).toBe(true);
    expect(mentionsTarget(here, "write to privacy@here.com")).toBe(true);
    const ip = target({
      targetName: "192.com",
      targetDomain: "192.com",
      replyDomains: ["192.com"],
    });
    expect(mentionsTarget(ip, "Login from 192.168.1.20")).toBe(false);
    expect(mentionsTarget(ip, "see 192.com")).toBe(true);
    const start = target({
      targetName: "Start.io",
      targetDomain: "start.io",
      replyDomains: ["start.io"],
    });
    expect(mentionsTarget(start, "Start your free trial")).toBe(false);
    expect(mentionsTarget(start, "Start.io privacy desk")).toBe(true);
  });

  it("names a target by a domain label that spells the lead of its name", () => {
    const getEmails = target({
      targetName: "Equifax Information Services LLC",
      targetDomain: "equifax.com",
    });
    expect(namesOf(getEmails)).toEqual(
      expect.arrayContaining(["equifax", "equifax information services"]),
    );
    const retention = target({ targetName: "GetEmails", targetDomain: "retention.com" });
    expect(namesOf(retention)).toEqual(["getemails"]);
  });

  it("keeps the whole name of a target whose words are all generic", () => {
    const usa = target({ targetName: "USA People Search", targetDomain: "usa-people-search.com" });
    expect(mentionsTarget(usa, "USA People Search Support")).toBe(true);
    expect(mentionsTarget(usa, "people search results")).toBe(false);
  });

  it("matches a name too short to fold only as written", () => {
    const hm = target({ targetName: "H&M", targetDomain: "hm.com", replyDomains: ["hm.com"] });
    expect(exactNamesOf(hm)).toEqual(["H&M"]);
    expect(["H&M Privacy", "H & M"].map((t) => mentionsTarget(hm, t))).toEqual([true, true]);
    expect(mentionsTarget(hm, "h&m")).toBe(false);
    const hp = target({ targetName: "HP", targetDomain: "hp.com", replyDomains: ["hp.com"] });
    expect(mentionsTarget(hp, "Thanks, HP Privacy")).toBe(true);
    expect(mentionsTarget(hp, "hp and others")).toBe(false);
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

describe("the names of every target in the dataset", () => {
  const requests = hasGeneratedDataset()
    ? [
        ...loadBrokers().map((broker) => ({
          targetId: broker.id,
          targetName: broker.name,
          targetDomain: broker.domain,
          replyDomains: [broker.domain],
          curatedReplyDomains: withoutSharedHosts(broker.replyDomains ?? []),
          replyAddresses: [],
          brands: [...(broker.ownerGroup ? [broker.ownerGroup] : []), ...(broker.aliases ?? [])],
        })),
        ...loadCompanies().map((company) => ({
          targetId: company.id,
          targetName: company.name,
          targetDomain: company.domain,
          replyDomains: [company.domain],
          curatedReplyDomains: [],
          replyAddresses: [],
          brands: [],
        })),
      ]
    : [];
  const NEVER_A_NAME = [
    "here",
    "experience",
    "precisely",
    "retention",
    "start",
    "instantly",
    "supplier",
    "persistent",
    "degree",
    "consider",
    "decide",
    "structure",
    "business",
    "healthcare",
    "enterprise",
    "united",
    "unity",
    "ring",
    "square",
    "block",
    "connection",
    "addresses",
    "archives",
  ];
  const curated = (request: (typeof requests)[number]) =>
    (request.brands ?? []).flatMap((brand) => brand.split(/[()]/).map((part) => part.trim()));

  it.skipIf(requests.length === 0)("never names a target by a number or an everyday word", () => {
    const offenders = requests.flatMap((request) =>
      namesOf(request)
        .filter((name) => /^[0-9 ]+$/.test(name) || NEVER_A_NAME.includes(name))
        .filter((name) => !curated(request).some((brand) => brand.toLowerCase() === name))
        .map((name) => `${request.targetName}: ${name}`),
    );
    expect(offenders).toEqual([]);
  });

  it.skipIf(requests.length === 0)(
    "names the target in a signature, whatever its punctuation",
    () => {
      const unnamed = requests
        .filter((request) => /['’&]/.test(request.targetName))
        .filter((request) => !mentionsTarget(request, `${request.targetName} Privacy Team`))
        .map((request) => request.targetName);
      expect(unnamed).toEqual([]);
    },
  );

  it.skipIf(requests.length === 0)("leaves few targets without a name of their own", () => {
    const nameless = requests
      .filter((request) => namesOf(request).length === 0 && exactNamesOf(request).length === 0)
      .map((request) => request.targetName);
    expect(nameless.length).toBeLessThan(requests.length * 0.1);
    const unreachable = requests
      .filter((request) => namesOf(request).length === 0 && exactNamesOf(request).length === 0)
      .filter((request) => domainsOf(request).length === 0)
      .map((request) => request.targetName);
    expect(unreachable).toEqual([]);
  });
});
