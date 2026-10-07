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
    logLevel: parsed.LOG_LEVEL,
  };
}
