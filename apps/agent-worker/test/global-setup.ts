import { FIXTURE_PORTS_ENV, FIXTURE_SLOTS, startFixtureServer } from "./fixtures/server.js";

/** One fixture site for every worker slot, on ports the operating system picks and the test processes inherit. */
export default async function setup(): Promise<() => Promise<void>> {
  const fixtures = await Promise.all(Array.from({ length: FIXTURE_SLOTS }, startFixtureServer));
  process.env[FIXTURE_PORTS_ENV] = fixtures.map((fixture) => fixture.port).join(",");
  return async () => {
    await Promise.all(fixtures.map((fixture) => fixture.close()));
  };
}
