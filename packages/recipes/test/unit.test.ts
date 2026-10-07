import { describe, expect, it } from "vitest";
import {
  classifySignals,
  createRedactor,
  DEFAULT_TIMEOUTS,
  describeSelector,
  HUMAN_PACE,
  INSTANT_PACE,
  interstitialIn,
  RunFailure,
  sleepFor,
} from "../src/index.js";
import { toFailure } from "../src/runner/errors.js";
import { ageFrom } from "../src/runner/extract.js";
import { keyDelay, typesByKey } from "../src/runner/pacing.js";

const quiet = { title: "Privacy", text: "Opt out here", textLength: 12, widgets: [], markers: [] };

describe("createRedactor", () => {
  const redact = createRedactor({
    first_name: "Jordan",
    last_name: "Example",
    email: "jordan@example.com",
    state: "TX",
  });

  it("replaces a value as typed, as encoded, and as a slug, ignoring case", () => {
    expect(redact("no such page /jordan-example and Jordan Example and jordan%40example.com")).toBe(
      "no such page /{{first_name}}-{{last_name}} and {{first_name}} {{last_name}} and {{email}}",
    );
  });

  it("prefers the longest value, so an address is not cut in two", () => {
    expect(redact("sent to jordan@example.com")).toBe("sent to {{email}}");
  });

  it("leaves very short values alone, which would mangle ordinary words", () => {
    expect(redact("TX is a state")).toBe("TX is a state");
  });

  it("is the identity without any usable value", () => {
    expect(createRedactor({ email: "  " })("anything")).toBe("anything");
  });

  it("treats regular expression characters in a value literally", () => {
    expect(createRedactor({ full_name: "A.B (C)" })("name A.B (C) and AxB (C)")).toBe(
      "name {{full_name}} and AxB (C)",
    );
  });
});

describe("telling a bot wall from a page", () => {
  it.each([
    ["a Cloudflare title", { ...quiet, title: "Just a moment..." }],
    ["an attention required title", { ...quiet, title: "Attention Required! | Cloudflare" }],
    ["an access denied title", { ...quiet, title: "Access Denied" }],
    ["a challenge element", { ...quiet, markers: ["#challenge-form"] }],
    [
      "short verification text",
      { ...quiet, text: "Verifying you are human. This may take a few seconds." },
    ],
    ["a press and hold prompt", { ...quiet, text: "Press & Hold to confirm" }],
    [
      "a security review notice",
      { ...quiet, text: "example.test needs to review the security of your connection" },
    ],
  ])("recognizes %s", (_name, signals) => {
    expect(interstitialIn(signals)).not.toBeNull();
  });

  it("ignores those words in a long page", () => {
    expect(
      interstitialIn({
        ...quiet,
        text: "verify you are human",
        textLength: 9000,
      }),
    ).toBeNull();
  });

  it("is bot_detection and transient for a whole page, captcha and lasting for a widget", () => {
    expect(classifySignals({ ...quiet, title: "Just a moment..." }, [])).toMatchObject({
      reason: "bot_detection",
      transient: true,
    });
    expect(classifySignals({ ...quiet, widgets: ["hcaptcha"] }, [])).toMatchObject({
      reason: "captcha",
      transient: false,
      detail: expect.stringContaining("hCaptcha"),
    });
  });

  it("finds a widget that is only in a frame", () => {
    expect(classifySignals(quiet, [{ ...quiet, widgets: ["turnstile"] }])).toMatchObject({
      reason: "captcha",
    });
  });

  it("is null for an ordinary page", () => {
    expect(classifySignals(quiet, [quiet])).toBeNull();
  });
});

describe("pacing", () => {
  it("types by key only when the pace has a delay", () => {
    expect(typesByKey(HUMAN_PACE)).toBe(true);
    expect(typesByKey(INSTANT_PACE)).toBe(false);
  });

  it("keeps a human key delay inside its range and adds a hesitation now and then", () => {
    const base = { ...HUMAN_PACE, hesitationChance: 0 };
    for (let i = 0; i < 200; i++) {
      const delay = keyDelay(base);
      expect(delay).toBeGreaterThanOrEqual(base.typeDelayMs[0]);
      expect(delay).toBeLessThanOrEqual(base.typeDelayMs[1]);
    }
    const hesitant = { ...HUMAN_PACE, hesitationChance: 1, random: () => 0 };
    expect(keyDelay(hesitant)).toBe(HUMAN_PACE.typeDelayMs[0] + HUMAN_PACE.hesitationMs[0]);
  });

  it("sleeps for the time asked, and ends early when aborted", async () => {
    const started = Date.now();
    await sleepFor(60);
    expect(Date.now() - started).toBeGreaterThanOrEqual(55);

    const controller = new AbortController();
    setTimeout(() => controller.abort(), 20);
    const slept = Date.now();
    await sleepFor(10_000, controller.signal);
    expect(Date.now() - slept).toBeLessThan(1000);
    await sleepFor(10_000, controller.signal);
  });
});

describe("failures", () => {
  it("keeps a typed failure and never retries a recipe failure", () => {
    const failure = new RunFailure("recipe", "gone");
    expect(toFailure(failure)).toBe(failure);
    expect(failure.retryable).toBe(false);
    expect(new RunFailure("site", "down").retryable).toBe(true);
    expect(new RunFailure("network", "dropped").retryable).toBe(true);
  });

  it("classifies a dropped connection as network and anything unknown as internal", () => {
    expect(
      toFailure(new Error("page.goto: net::ERR_CONNECTION_RESET at https://x.test")).kind,
    ).toBe("network");
    expect(toFailure(new Error("Target page, context or browser has been closed"))).toMatchObject({
      kind: "internal",
      retryable: true,
    });
    expect(toFailure("odd")).toMatchObject({ kind: "internal", message: "odd" });
  });

  it("cuts a long message to its first line", () => {
    expect(toFailure(new Error("first line\nCall log:\n  - noise")).message).toBe("first line");
  });
});

describe("describeSelector", () => {
  it("names every strategy and never any page content", () => {
    expect(
      describeSelector({
        role: "button",
        label: "Send",
        testId: "go",
        css: "#go",
        text: "Send it",
      }),
    ).toBe('role=button[name="Send"] | testid=go | css=#go | text="Send it"');
    expect(describeSelector({ label: "Email" })).toBe('label="Email"');
  });
});

describe("defaults", () => {
  it("leave room for a slow site but bound a run", () => {
    expect(DEFAULT_TIMEOUTS.optionalMs).toBeLessThan(DEFAULT_TIMEOUTS.stepMs);
    expect(DEFAULT_TIMEOUTS.runMs).toBeLessThan(5 * 60_000);
  });
});

describe("ageFrom", () => {
  it("takes the first whole number in the text", () => {
    expect(ageFrom(["Age - 77"])).toBe(77);
    expect(ageFrom(["John Smith, 45 (born 1980)"])).toBe(45);
    expect(ageFrom(["Age 5, lived at 1234 Main St"])).toBe(5);
    expect(ageFrom(["102"])).toBe(102);
  });

  it("is undefined without a number or with an impossible one", () => {
    expect(ageFrom(undefined)).toBeUndefined();
    expect(ageFrom([])).toBeUndefined();
    expect(ageFrom(["Age unknown"])).toBeUndefined();
    expect(ageFrom(["Since 1980"])).toBeUndefined();
    expect(ageFrom(["131"])).toBeUndefined();
  });

  it("reads only the first value", () => {
    expect(ageFrom(["no age", "44"])).toBeUndefined();
  });
});
