import { FIXTURE_PORT_ENV, startFixtureServer } from "./fixtures/server.js";

/** One fixture site for every test file, on a port the operating system picks and the test processes inherit. */
export default async function setup(): Promise<() => Promise<void>> {
  const fixture = await startFixtureServer();
  process.env[FIXTURE_PORT_ENV] = String(fixture.port);
  return fixture.close;
}
