import { describe, it } from "vitest";

/** What an integration test needs from outside the process. */
type IntegrationNeed = "greenmail";

const NEEDS: Record<IntegrationNeed, { variable: string; what: string }> = {
  greenmail: {
    variable: "GREENMAIL_HOST",
    what: "a GreenMail server (docker run greenmail/standalone)",
  },
};

/** Why a need is not met, or null when it is. */
export function integrationUnavailable(
  need: IntegrationNeed,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const { variable, what } = NEEDS[need];
  return env[variable] ? null : `${variable} is not set, so there is no ${what} to test against`;
}

/**
 * A suite that needs a service which is not always there. Locally it is skipped when the service is
 * missing, so `pnpm test` works on a laptop without Docker. In CI, `KICKROCKS_REQUIRE_INTEGRATION=1`
 * turns that skip into a failure, so a broken or forgotten service can never make the integration
 * tests quietly pass by not running.
 */
export function describeIntegration(
  need: IntegrationNeed,
  name: string,
  suite: () => void,
  {
    env = process.env,
    runner = vitestRunner,
  }: { env?: NodeJS.ProcessEnv; runner?: SuiteRunner } = {},
): void {
  const missing = integrationUnavailable(need, env);
  if (missing === null) {
    runner.describe(name, suite);
  } else if (env.KICKROCKS_REQUIRE_INTEGRATION === "1") {
    runner.describe(name, () => {
      runner.it("has the service it needs", () => {
        throw new Error(`${missing}, and KICKROCKS_REQUIRE_INTEGRATION=1 forbids skipping`);
      });
    });
  } else {
    runner.skip(name, suite);
  }
}

/** How a suite is registered, so a test can see what `describeIntegration` chose without running it. */
export interface SuiteRunner {
  describe(name: string, suite: () => void): void;
  skip(name: string, suite: () => void): void;
  it(name: string, test: () => void): void;
}

const vitestRunner: SuiteRunner = {
  describe: (name, suite) => describe(name, suite),
  skip: (name, suite) => describe.skip(name, suite),
  it: (name, test) => it(name, test),
};
