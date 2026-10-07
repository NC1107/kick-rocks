import { describe, expect, it } from "vitest";
import { describeIntegration, integrationUnavailable, type SuiteRunner } from "./integration.js";

function recorder() {
  const calls: string[] = [];
  let failing: (() => void) | undefined;
  const runner: SuiteRunner = {
    describe: (name, suite) => {
      calls.push(`describe ${name}`);
      suite();
    },
    skip: (name) => void calls.push(`skip ${name}`),
    it: (name, test) => {
      calls.push(`it ${name}`);
      failing = test;
    },
  };
  return { calls, runner, run: () => failing?.() };
}

describe("integrationUnavailable", () => {
  it("is null when the service is configured and says what is missing when it is not", () => {
    expect(integrationUnavailable("greenmail", { GREENMAIL_HOST: "localhost" })).toBeNull();
    expect(integrationUnavailable("greenmail", {})).toMatch(/GREENMAIL_HOST is not set/);
    expect(integrationUnavailable("greenmail", { GREENMAIL_HOST: "" })).not.toBeNull();
  });
});

describe("describeIntegration", () => {
  it("runs the suite when the service is there", () => {
    const { calls, runner } = recorder();
    describeIntegration("greenmail", "mail", () => calls.push("body"), {
      env: { GREENMAIL_HOST: "localhost" },
      runner,
    });
    expect(calls).toEqual(["describe mail", "body"]);
  });

  it("skips it on a machine without the service", () => {
    const { calls, runner } = recorder();
    describeIntegration("greenmail", "mail", () => calls.push("body"), { env: {}, runner });
    expect(calls).toEqual(["skip mail"]);
  });

  it("fails instead of skipping when CI says the service is required", () => {
    const { calls, runner, run } = recorder();
    describeIntegration("greenmail", "mail", () => calls.push("body"), {
      env: { KICKROCKS_REQUIRE_INTEGRATION: "1" },
      runner,
    });
    expect(calls).toEqual(["describe mail", "it has the service it needs"]);
    expect(run).toThrow(/GREENMAIL_HOST is not set.*forbids skipping/);
  });

  it("does not let the requirement fail a suite whose service is there", () => {
    const { calls, runner } = recorder();
    describeIntegration("greenmail", "mail", () => calls.push("body"), {
      env: { KICKROCKS_REQUIRE_INTEGRATION: "1", GREENMAIL_HOST: "localhost" },
      runner,
    });
    expect(calls).toEqual(["describe mail", "body"]);
  });
});
