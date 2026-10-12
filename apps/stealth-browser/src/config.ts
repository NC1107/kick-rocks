import { z } from "zod";

const Env = z.object({
  KICKROCKS_WORKER_TOKEN: z
    .string()
    .min(16, "KICKROCKS_WORKER_TOKEN must be at least 16 characters"),
  KICKROCKS_CHROME_PROFILE: z.string().default("./.chrome-profile"),
  KICKROCKS_STEALTH_BROWSER_PORT: z.coerce.number().int().positive().default(8422),
  KICKROCKS_STEALTH_BROWSER_HOST: z.string().default("0.0.0.0"),
  KICKROCKS_WORKER_HEADLESS: z.enum(["true", "false"]).default("false"),
  KICKROCKS_WORKER_NO_SANDBOX: z.enum(["true", "false"]).default("false"),
  KICKROCKS_WORKER_PROXY: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export interface StealthBrowserConfig {
  token: string;
  chromeProfileDir: string;
  port: number;
  host: string;
  headless: boolean;
  noSandbox: boolean;
  proxyServer: string | null;
  logLevel: string;
}

function withoutEmpty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, v]) => v !== ""));
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): StealthBrowserConfig {
  const parsed = Env.parse(withoutEmpty(env));
  return {
    token: parsed.KICKROCKS_WORKER_TOKEN,
    chromeProfileDir: parsed.KICKROCKS_CHROME_PROFILE,
    port: parsed.KICKROCKS_STEALTH_BROWSER_PORT,
    host: parsed.KICKROCKS_STEALTH_BROWSER_HOST,
    headless: parsed.KICKROCKS_WORKER_HEADLESS === "true",
    noSandbox: parsed.KICKROCKS_WORKER_NO_SANDBOX === "true",
    proxyServer: parsed.KICKROCKS_WORKER_PROXY ?? null,
    logLevel: parsed.LOG_LEVEL,
  };
}
