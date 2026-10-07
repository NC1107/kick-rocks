/** Where the development stack of `docker-compose.dev.yml` is reachable from the host. */
export const STACK = {
  serverUrl: "http://127.0.0.1:8520",
  fixtureUrl: "http://127.0.0.1:8530",
  smtpPort: 3525,
  imapPort: 3643,
  host: "127.0.0.1",
  workerToken: process.env.KICKROCKS_WORKER_TOKEN ?? "e2e-worker-token-0123456789abcdef",
  /** How the server container reaches GreenMail, which is not how this process does. */
  insideStack: { mailHost: "greenmail", smtpPort: 3025, imapPort: 3143 },
} as const;

/** The people-search fixture, as the worker and the server see it. */
export const FIXTURE_HOSTS = {
  people: "fixture-people.test",
  captcha: "fixture-captcha.test",
  link: "fixture-link.test",
  linkScript: "fixture-linkjs.test",
} as const;

export function fixtureLink(host: string, path: string): string {
  return `http://${host}:8530${path}`;
}
