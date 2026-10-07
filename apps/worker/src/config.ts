import { hostname } from "node:os";
import { resolve } from "node:path";
import { LEASE_MS, WebUrl } from "@kickrocks/shared";
import { z } from "zod";

const Env = z.object({
  KICKROCKS_SERVER_URL: WebUrl.default("http://127.0.0.1:8420"),
  KICKROCKS_WORKER_TOKEN: z
    .string()
    .min(16, "KICKROCKS_WORKER_TOKEN must be at least 16 characters"),
  KICKROCKS_WORKER_ID: z.string().min(1).max(100).default(hostname()),
  KICKROCKS_WORKER_POLL_MS: z.coerce.number().int().min(500).default(5000),
  // The server rejects any other lease, so a bad value is caught at startup instead of at the first claim.
  KICKROCKS_WORKER_LEASE_MS: z.coerce
    .number()
    .int()
    .min(LEASE_MS.min)
    .max(LEASE_MS.max)
    .default(LEASE_MS.default),
  KICKROCKS_CHROME_PROFILE: z.string().default("./.chrome-profile"),
  KICKROCKS_WORKER_HEADLESS: z.enum(["true", "false"]).default("false"),
  /** Docker's default seccomp profile denies the user namespaces Chrome's sandbox needs, so the image turns it off and relies on the container, an unprivileged user, and dropped capabilities. */
  KICKROCKS_WORKER_NO_SANDBOX: z.enum(["true", "false"]).default("false"),
  /** Lets a record or confirmation link on plain http through, for a fixture site on this machine. */
  KICKROCKS_WORKER_ALLOW_HTTP: z.enum(["true", "false"]).default("false"),
  /** `instant` skips the human typing rhythm, for tests against a fixture site. */
  KICKROCKS_WORKER_PACE: z.enum(["human", "instant"]).default("human"),
  /** An http proxy that all of the browser's traffic goes through, such as the egress filter in the production stack. */
  KICKROCKS_WORKER_PROXY: WebUrl.optional(),
  /** A specific Chrome or Chromium binary, instead of the installed Chrome or Playwright's Chromium. */
  KICKROCKS_CHROME_EXECUTABLE: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export interface WorkerConfig {
  serverUrl: string;
  token: string;
  workerId: string;
  pollMs: number;
  leaseMs: number;
  chromeProfileDir: string;
  headless: boolean;
  noSandbox: boolean;
  allowHttp: boolean;
  pace: "human" | "instant";
  chromeExecutable: string | null;
  proxyServer: string | null;
  logLevel: z.infer<typeof Env>["LOG_LEVEL"];
}

/** Variables that are set but empty count as unset, which is how compose passes an absent value. */
function withoutEmpty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
}

export function loadWorkerConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = Env.parse(withoutEmpty(env));
  return {
    serverUrl: parsed.KICKROCKS_SERVER_URL.replace(/\/+$/, ""),
    token: parsed.KICKROCKS_WORKER_TOKEN,
    workerId: parsed.KICKROCKS_WORKER_ID,
    pollMs: parsed.KICKROCKS_WORKER_POLL_MS,
    leaseMs: parsed.KICKROCKS_WORKER_LEASE_MS,
    chromeProfileDir: resolve(parsed.KICKROCKS_CHROME_PROFILE),
    headless: parsed.KICKROCKS_WORKER_HEADLESS === "true",
    noSandbox: parsed.KICKROCKS_WORKER_NO_SANDBOX === "true",
    allowHttp: parsed.KICKROCKS_WORKER_ALLOW_HTTP === "true",
    pace: parsed.KICKROCKS_WORKER_PACE,
    chromeExecutable: parsed.KICKROCKS_CHROME_EXECUTABLE
      ? resolve(parsed.KICKROCKS_CHROME_EXECUTABLE)
      : null,
    proxyServer: parsed.KICKROCKS_WORKER_PROXY ?? null,
    logLevel: parsed.LOG_LEVEL,
  };
}
