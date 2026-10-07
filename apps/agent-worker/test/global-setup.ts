import { startFixtureServer } from "./fixtures/server.js";

/** One fixture site for every test file, so the port is bound once. */
export default async function setup(): Promise<() => Promise<void>> {
  const fixture = await startFixtureServer();
  return fixture.close;
}
