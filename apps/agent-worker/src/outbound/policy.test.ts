import { describe, expect, it } from "vitest";
import { decide, type Facts, isChallengeHost } from "./policy.js";

const base: Facts = {
  party: "target",
  method: "GET",
  hasBody: false,
  unreadable: false,
  truncated: false,
  opaqueBody: false,
  urlCredentials: false,
  carriesContact: false,
  carriesLookup: false,
  touched: false,
  challengeHost: false,
};

const facts = (change: Partial<Facts>): Facts => ({ ...base, ...change });

describe("the outgoing rules", () => {
  it("let an ordinary request to the target through", () => {
    expect(decide(base)).toMatchObject({ action: "continue" });
    expect(decide(facts({ method: "POST", hasBody: true }))).toMatchObject({ action: "continue" });
  });

  it("hold any request that carries a contact value (R1)", () => {
    expect(decide(facts({ carriesContact: true }))).toMatchObject({ action: "send", rule: "R1" });
    expect(decide(facts({ carriesContact: true, method: "POST", hasBody: true }))).toMatchObject({
      action: "send",
    });
  });

  it("log a GET that carries only lookup values and hold none (R1')", () => {
    expect(decide(facts({ carriesLookup: true }))).toMatchObject({ action: "lookup" });
    expect(decide(facts({ carriesLookup: true, method: "HEAD" }))).toMatchObject({
      action: "lookup",
    });
  });

  it("hold every body to the target once the run has touched the page (R2)", () => {
    expect(decide(facts({ touched: true, method: "POST", hasBody: true }))).toMatchObject({
      action: "send",
      rule: "R2",
    });
    expect(
      decide(facts({ touched: true, carriesLookup: true, method: "POST", hasBody: true })),
    ).toMatchObject({ action: "send" });
  });

  it("lets a page-load POST through before the run touched anything", () => {
    expect(decide(facts({ method: "POST", hasBody: true }))).toMatchObject({ action: "continue" });
  });

  it("refuses a body that could not be read in full, whether or not it carries anything (U)", () => {
    const verdict = decide(
      facts({ touched: true, method: "POST", hasBody: true, unreadable: true }),
    );
    expect(verdict).toMatchObject({ action: "refuse", rule: "U", reason: "unreadable_body" });
    expect(
      decide(facts({ carriesContact: true, method: "POST", hasBody: true, unreadable: true })),
    ).toMatchObject({ action: "refuse" });
    expect(decide(facts({ method: "POST", hasBody: true, unreadable: true }))).toMatchObject({
      action: "continue",
    });
  });

  it("refuses a request with no body that was cut short and carries a contact value (U)", () => {
    expect(decide(facts({ carriesContact: true, unreadable: true }))).toMatchObject({
      action: "refuse",
      rule: "U",
    });
  });

  describe("for another site", () => {
    const third = (change: Partial<Facts>) => facts({ party: "third", ...change });

    it("refuse any value outright, lookup or contact (R1'')", () => {
      expect(decide(third({ carriesContact: true }))).toMatchObject({
        action: "refuse",
        reason: "third_party_value",
      });
      expect(decide(third({ carriesLookup: true }))).toMatchObject({
        action: "refuse",
        reason: "third_party_value",
      });
    });

    it("refuse every request once the run has touched the page (R3)", () => {
      expect(decide(third({ touched: true }))).toMatchObject({
        action: "refuse",
        reason: "third_party_after_touch",
      });
    });

    it("let a request through before the run touched anything", () => {
      expect(decide(third({}))).toMatchObject({ action: "continue" });
    });

    it("let a human check's own requests through after the touch, if they carry nothing (R2')", () => {
      expect(decide(third({ touched: true, challengeHost: true, hasBody: true }))).toMatchObject({
        action: "continue",
      });
      expect(
        decide(third({ touched: true, challengeHost: true, carriesContact: true })),
      ).toMatchObject({ action: "refuse" });
    });
  });
});

describe("the hosts of human checks", () => {
  it.each([
    "https://www.google.com/recaptcha/api2/anchor?k=1",
    "https://www.gstatic.com/recaptcha/releases/x/recaptcha__en.js",
    "https://www.recaptcha.net/recaptcha/api.js",
    "https://js.hcaptcha.com/1/api.js",
    "https://newassets.hcaptcha.com/captcha/v1/x",
    "https://challenges.cloudflare.com/turnstile/v0/api.js",
  ])("know %s", (url) => {
    expect(isChallengeHost(url)).toBe(true);
  });

  it.each([
    "https://www.google.com/search?q=x",
    "https://evil.example/recaptcha/",
    "https://cloudflare.com/x",
    "not a url",
  ])("do not know %s", (url) => {
    expect(isChallengeHost(url)).toBe(false);
  });
});

describe("a request cut short fails closed", () => {
  const refused = { action: "refuse", rule: "U", reason: "unreadable_body" };

  it.each([
    ["unreadable", { unreadable: true }],
    ["truncated", { truncated: true }],
  ] as const)(
    "refuses a bodiless GET to the target after the run touched the page when it is %s",
    (_, cut) => {
      expect(decide(facts({ touched: true, ...cut }))).toMatchObject(refused);
      expect(decide(facts({ touched: true, method: "HEAD", ...cut }))).toMatchObject(refused);
    },
  );

  it("refuses an unreadable request that carries a lookup value before the run touched anything", () => {
    expect(decide(facts({ unreadable: true, carriesLookup: true }))).toMatchObject(refused);
  });

  it("refuses an unreadable request to a third party whatever it carries", () => {
    expect(decide(facts({ party: "third", unreadable: true }))).toMatchObject(refused);
    expect(decide(facts({ party: "third", unreadable: true, challengeHost: true }))).toMatchObject(
      refused,
    );
  });
});

describe("a request the gate refuses by its shape", () => {
  it("refuses a username or password in the address, for any party and any method", () => {
    for (const party of ["target", "third"] as const) {
      expect(decide(facts({ party, urlCredentials: true }))).toMatchObject({
        action: "refuse",
        reason: "url_credentials",
      });
    }
  });

  it.each(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "post"])(
    "lets %s through",
    (method) => {
      expect(decide(facts({ method })).action).not.toBe("refuse");
    },
  );

  it.each(["PROPFIND", "TRACE", "JORDANEXAMPLE", ""])("refuses the method %j", (method) => {
    for (const party of ["target", "third"] as const) {
      expect(decide(facts({ party, method }))).toMatchObject({
        action: "refuse",
        reason: "method_not_allowed",
      });
    }
  });

  it("refuses a body it could not open once the run touched the page, and holds none", () => {
    const opaque = { method: "POST", hasBody: true, opaqueBody: true } as const;
    expect(decide(facts({ touched: true, ...opaque }))).toMatchObject({
      action: "refuse",
      reason: "unreadable_body",
    });
    expect(decide(facts(opaque))).not.toMatchObject({ action: "refuse" });
    expect(decide(facts({ ...opaque, carriesContact: true }))).toMatchObject({
      action: "refuse",
      reason: "unreadable_body",
    });
  });
});
