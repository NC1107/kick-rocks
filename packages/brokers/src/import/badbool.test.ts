import { Broker, normalizeDomain } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { readPinnedUpstream } from "../upstream.js";
import { parseBadbool, parseBadboolReport } from "./badbool.js";

/** Enough synthetic people-search entries to pass the format guard, none of them real sites. */
function filler(count: number): string {
  return Array.from(
    { length: count },
    (_, i) =>
      `### Filler${i}\nFind [your information](https://www.filler${i}.example/) and [opt out](https://www.filler${i}.example/optout).\n`,
  ).join("\n");
}

function readme(entries: string): string {
  return `# List\n\n## Search Engines\n### Not A Broker\nSee [this](https://search.example/).\n\n## People Search Sites\n\n${entries}\n${filler(30)}\n## Special Circumstances\n### 📞 Consider freezing your credit\nCall [Bureau](https://bureau.example/freeze).\n`;
}

function parseOne(entry: string) {
  const brokers = parseBadbool(readme(entry));
  const found = brokers.find((broker) => !broker.id.startsWith("filler"));
  if (!found) throw new Error("entry was not imported");
  return found;
}

describe("parseBadbool markers", () => {
  it("reads the crucial marker as crucial priority", () => {
    expect(parseOne("### \u{1F490} Alpha\n[Find](https://alpha.example/)\n").priority).toBe(
      "crucial",
    );
  });

  it("reads the high priority marker with or without its variation selector", () => {
    expect(parseOne("### ☠ Alpha\n[Find](https://alpha.example/)\n").priority).toBe("high");
    expect(parseOne("### ☠️ Alpha\n[Find](https://alpha.example/)\n").priority).toBe("high");
  });

  it("leaves an unmarked entry at normal priority", () => {
    expect(parseOne("### Alpha\n[Find](https://alpha.example/)\n").priority).toBe("normal");
  });

  it("maps phone and id markers to requirements, in any order, with no space after the first", () => {
    const broker = parseOne(
      "### \u{1F490}\u{1F4DE} \u{1F4B0} \u{1F3AB} Alpha\n[Find](https://alpha.example/)\n",
    );
    expect(broker.name).toBe("Alpha");
    expect(broker.priority).toBe("crucial");
    expect(broker.requirements).toEqual(expect.arrayContaining(["phone_call", "id_upload"]));
    expect(broker.requiresId).toBe(true);
    expect(broker.category).toBe("requires-id");
  });

  it("does not read the money-bag marker as a charge for removal", () => {
    const broker = parseOne("### \u{1F4B0} Alpha\n[Find](https://alpha.example/)\n");
    expect(broker.name).toBe("Alpha");
    expect(broker.requirements).not.toContain("paid");
  });

  it("does not leave marker characters in the name or the id", () => {
    const broker = parseOne("### \u{1F490} \u{1F4DE} Alpha Beta\n[Find](https://alpha.example/)\n");
    expect(broker.name).toBe("Alpha Beta");
    expect(broker.id).toBe("alpha-beta");
  });
});

describe("parseBadbool links", () => {
  it("separates the search link from the opt-out link and records the record URL requirement", () => {
    const broker = parseOne(
      "### Alpha\nFind [your information](https://www.alpha.example/search) and [opt out](https://www.alpha.example/optout).\n",
    );
    expect(broker.searchUrl).toBe("https://www.alpha.example/search");
    expect(broker.optOutUrl).toBe("https://www.alpha.example/optout");
    expect(broker.domain).toBe("alpha.example");
    expect(broker.requirements).toContain("record_url");
    expect(broker.contactMethod).toBe("form");
  });

  it("prefers a strong opt-out link over a privacy rights page listed before it", () => {
    const broker = parseOne(
      "### Alpha\nSee the [privacy rights page](https://alpha.example/privacy-rights). Then [opt out](https://alpha.example/opt-out).\n",
    );
    expect(broker.optOutUrl).toBe("https://alpha.example/opt-out");
  });

  it("takes the opt-out link from another domain when the broker hands the removal to a partner", () => {
    const broker = parseOne(
      "### Alpha\n[Search](https://www.alpha.example). If found, opt out on [Partner's opt-out page](https://www.partner.example/optout).\n",
    );
    expect(broker.domain).toBe("alpha.example");
    expect(broker.optOutUrl).toBe("https://www.partner.example/optout");
  });

  it("uses a hostname heading as the domain and drops .com from the id", () => {
    const broker = parseOne(
      "### Alpha.com\nUse the [removal form](https://help.alpha.com/removal).\n",
    );
    expect(broker.domain).toBe("alpha.com");
    expect(broker.id).toBe("alpha");
  });

  it("keeps a non-com hostname in the id so two spellings of one name stay apart", () => {
    const a = parseBadbool(
      readme(
        "### Beta.com\n[Search](https://beta.com/)\n\n### Beta.net\n[Search](https://beta.net/)\n",
      ),
    );
    expect(a.find((broker) => broker.domain === "beta.com")?.id).toBe("beta");
    expect(a.find((broker) => broker.domain === "beta.net")?.id).toBe("beta-net");
  });

  it("reduces a subdomain to the registrable domain", () => {
    const broker = parseOne(
      "### Gamma\nGo to the [opt-out page](https://dashboard.gamma.example/opt-out).\n",
    );
    expect(broker.domain).toBe("gamma.example");
    expect(broker.website).toBe("https://gamma.example");
  });

  it("never turns a mailto link into a web URL", () => {
    const broker = parseOne(
      "### Alpha\n[Find](https://alpha.example/) or write to [privacy@alpha.example](mailto:privacy@alpha.example).\n",
    );
    expect(broker.privacyEmail).toBe("privacy@alpha.example");
    expect(broker.optOutUrl).toBeNull();
    expect(broker.searchUrl).toBe("https://alpha.example/");
    expect(broker.contactMethod).toBe("email");
  });

  it("rejects javascript and data links", () => {
    const broker = parseOne(
      "### Alpha\n[Find](https://alpha.example/) [opt out](javascript:alert(1)) [form](data:text/html,x)\n",
    );
    expect(broker.optOutUrl).toBeNull();
  });
});

describe("parseBadbool email", () => {
  it("reads angle-bracket and bare-link addresses", () => {
    expect(
      parseOne("### Alpha\n[Find](https://alpha.example/). Email <help@alpha.example>.\n")
        .privacyEmail,
    ).toBe("help@alpha.example");
    expect(
      parseOne(
        "### Alpha\n[Find](https://alpha.example/). Email [help+optout@alpha.example](help+optout@alpha.example).\n",
      ).privacyEmail,
    ).toBe("help+optout@alpha.example");
  });

  it("prefers an address on the broker's own domain", () => {
    const broker = parseOne(
      "### Alpha\n[Find](https://alpha.example/). Ask <a@other.example> or <b@mail.alpha.example>.\n",
    );
    expect(broker.privacyEmail).toBe("b@mail.alpha.example");
  });

  it("ignores an address that is offered only to users in other countries", () => {
    const broker = parseOne(
      "### Alpha\n[Opt out](https://alpha.example/optout). Users in Austria and Germany may email <de@alpha.example>.\n",
    );
    expect(broker.privacyEmail).toBeNull();
  });
});

describe("parseBadbool requirements from the prose", () => {
  it("finds captchas, email confirmation, accounts, fax, and postal mail", () => {
    const broker = parseOne(
      "### Alpha\n[Find](https://alpha.example/) and [opt out](https://alpha.example/optout). You may need to solve a captcha, then click the link in your inbox. Sign up for a free account first. Fax it to 1-555-0100 or mail in the form.\n",
    );
    expect(broker.requirements).toEqual(
      ["email_confirmation", "account", "captcha", "record_url", "postal_mail", "fax"].sort(
        (a, b) => order(a) - order(b),
      ),
    );
  });

  it("flags a record URL when the opt-out asks for a listing link but there is no search link", () => {
    const broker = parseOne(
      "### Alpha\nOpen [the opt-out page](https://alpha.example/optout) and paste the URL of your listing.\n",
    );
    expect(broker.requirements).toContain("record_url");
    expect(broker.searchUrl).toBeNull();
  });

  it("does not invent requirements for a plain entry", () => {
    expect(
      parseOne("### Alpha\nVisit the [removal form](https://alpha.example/removal).\n")
        .requirements,
    ).toEqual([]);
  });
});

function order(requirement: string): number {
  return [
    "email_confirmation",
    "phone_call",
    "id_upload",
    "captcha",
    "account",
    "record_url",
    "postal_mail",
    "fax",
  ].indexOf(requirement);
}

describe("parseBadbool sections and notes", () => {
  it("imports only the people search section, so freeze and search engine headings are not brokers", () => {
    const brokers = parseBadbool(readme("### Alpha\n[Find](https://alpha.example/)\n"));
    expect(brokers.map((broker) => broker.name)).not.toContain("Not A Broker");
    expect(brokers.map((broker) => broker.name)).not.toContain("Consider freezing your credit");
    expect(brokers.every((broker) => broker.category !== "registered-broker")).toBe(true);
  });

  it("keeps the entry text as plain notes with the link text and no markdown", () => {
    const broker = parseOne(
      "### Alpha\nFind [your information](https://alpha.example/). **Note:** this _is_ slow.\n",
    );
    expect(broker.notes).toBe("BADBOOL: Find your information. Note: this is slow.");
  });

  it("writes an em dash in the entry text as a plain dash", () => {
    const broker = parseOne(
      "### Alpha\n[Find](https://alpha.example/) it\u2014slow \u2014 but free.\n",
    );
    expect(broker.notes).toBe("BADBOOL: Find it - slow - but free.");
  });

  it("carries the source and license on every record", () => {
    for (const broker of parseBadbool(readme("### Alpha\n[Find](https://alpha.example/)\n"))) {
      expect(broker.sources).toEqual([
        { source: "badbool", license: "CC-BY-NC-SA-4.0", upstreamId: expect.any(String) },
      ]);
    }
  });

  it("tolerates Windows line endings", () => {
    const text = readme("### Alpha\n[Find](https://alpha.example/)\n").replace(/\n/g, "\r\n");
    expect(parseBadbool(text).some((broker) => broker.name === "Alpha")).toBe(true);
  });
});

describe("parseBadboolReport edge cases", () => {
  it("reports an entry with no readable domain instead of dropping it silently", () => {
    const report = parseBadboolReport(readme("### Nowhere\nCall 1-555-0100.\n"));
    expect(report.skipped).toEqual([{ name: "Nowhere", reason: expect.stringMatching(/domain/) }]);
  });

  it("reports a second entry for a domain already listed", () => {
    const report = parseBadboolReport(
      readme(
        "### Alpha\n[Find](https://alpha.example/)\n\n### Alpha Again\n[Find](https://alpha.example/)\n",
      ),
    );
    expect(report.brokers.filter((broker) => broker.domain === "alpha.example")).toHaveLength(1);
    expect(report.skipped).toEqual([
      { name: "Alpha Again", reason: expect.stringMatching(/already listed/) },
    ]);
  });

  it("gives colliding names distinct ids", () => {
    const report = parseBadboolReport(
      readme("### Same\n[Find](https://one.example/)\n\n### Same\n[Find](https://two.example/)\n"),
    );
    const ids = report.brokers.filter((b) => b.name === "Same").map((b) => b.id);
    expect(new Set(ids).size).toBe(2);
  });

  it("refuses a README that no longer looks like the list", () => {
    expect(() => parseBadbool("# Something else\n\n## People Search Sites\n### One\n")).toThrow(
      /format may have changed/,
    );
    expect(() => parseBadbool("")).toThrow(/format may have changed/);
  });
});

describe("the pinned BADBOOL README", () => {
  const text = readPinnedUpstream("BADBOOL-README.md");
  const { brokers, skipped } = parseBadboolReport(text);
  const byDomain = new Map(brokers.map((broker) => [broker.domain, broker]));

  it("produces valid brokers with unique ids and domains", () => {
    expect(brokers.length).toBeGreaterThanOrEqual(40);
    for (const broker of brokers) expect(() => Broker.parse(broker), broker.id).not.toThrow();
    expect(new Set(brokers.map((b) => b.id)).size).toBe(brokers.length);
    expect(new Set(brokers.map((b) => b.domain)).size).toBe(brokers.length);
    for (const broker of brokers) expect(normalizeDomain(broker.domain)).toBe(broker.domain);
  });

  it("skips nothing that has a link", () => {
    expect(skipped).toEqual([]);
  });

  it("reads the crucial sites with their links", () => {
    const spokeo = byDomain.get("spokeo.com");
    expect(spokeo?.priority).toBe("crucial");
    expect(spokeo?.requirements).toEqual(expect.arrayContaining(["record_url"]));
    expect(spokeo?.optOutUrl).toBe("https://www.spokeo.com/optout");
    expect(spokeo?.searchUrl).toBe("https://www.spokeo.com/search");

    const whitepages = byDomain.get("whitepages.com");
    expect(whitepages?.requirements).toEqual(expect.arrayContaining(["phone_call"]));

    const checkpeople = byDomain.get("checkpeople.com");
    expect(checkpeople?.optOutUrl).toBe("https://checkpeople.com/opt-out");

    const mylife = byDomain.get("mylife.com");
    expect(mylife?.privacyEmail).toBe("privacy@mylife.com");
    expect(mylife?.requirements).toContain("phone_call");
  });

  it("includes SmartBackgroundChecks, which the bundled recipes depend on", () => {
    const site = byDomain.get("smartbackgroundchecks.com");
    expect(site?.optOutUrl).toBe("https://www.smartbackgroundchecks.com/optout");
    expect(site?.priority).toBe("crucial");
  });

  it("marks high priority sites and the ID-upload face search sites", () => {
    expect(byDomain.get("familytreenow.com")?.priority).toBe("high");
    expect(byDomain.get("pimeyes.com")?.requiresId).toBe(true);
    expect(byDomain.get("pimeyes.com")?.requirements).toContain("id_upload");
    expect(byDomain.get("pimeyes.com")?.category).toBe("requires-id");
  });

  it("does not use the Austrian and German address for Acxiom", () => {
    expect(byDomain.get("acxiom.com")?.privacyEmail).toBeNull();
    expect(byDomain.get("acxiom.com")?.optOutUrl).toBe("https://www.acxiom.com/optout/");
  });

  it("keeps the two TruePeopleSearch sites apart", () => {
    expect(byDomain.get("truepeoplesearch.com")?.id).toBe("truepeoplesearch");
    expect(byDomain.get("truepeoplesearch.net")?.id).toBe("truepeoplesearch-net");
  });

  it("does not list Radaris, which the README dropped after its domains were transferred", () => {
    expect(byDomain.has("radaris.com")).toBe(false);
  });

  it("never puts an email or a non-web scheme into a URL field", () => {
    for (const broker of brokers) {
      for (const url of [broker.website, broker.optOutUrl, broker.searchUrl]) {
        if (url) expect(url, broker.id).toMatch(/^https?:\/\/[^@]*$/);
      }
    }
  });
});
