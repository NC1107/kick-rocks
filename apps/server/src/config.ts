import { resolve } from "node:path";
import { z } from "zod";

const Env = z.object({
  KICKROCKS_DATA_DIR: z.string().default("./data"),
  KICKROCKS_HOST: z.string().default("127.0.0.1"),
  KICKROCKS_PORT: z.coerce.number().int().positive().default(8420),
  KICKROCKS_WEB_DIST: z.string().optional(),
  KICKROCKS_PUBLIC_URL: z.url().optional(),
  KICKROCKS_WORKER_TOKEN: z
    .string()
    .min(16, "KICKROCKS_WORKER_TOKEN must be at least 16 characters")
    .optional(),
  KICKROCKS_EXTRA_TARGETS: z.string().optional(),
  KICKROCKS_EXTRA_RECIPES: z.string().optional(),
  KICKROCKS_SCHEDULER: z.enum(["on", "off"]).default("on"),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export interface Config {
  dataDir: string;
  dbPath: string;
  keyPath: string;
  host: string;
  port: number;
  webDist: string | null;
  /** The address people and agents use to reach the server, for links shown in the UI. */
  publicUrl: string;
  /** Null switches the worker API off. */
  workerToken: string | null;
  /** A JSON file of extra brokers and companies, for fixtures and power users. */
  extraTargetsPath: string | null;
  /** A directory of extra recipe files. */
  extraRecipesDir: string | null;
  schedulerEnabled: boolean;
  logLevel: z.infer<typeof Env>["LOG_LEVEL"];
  env: z.infer<typeof Env>["NODE_ENV"];
}

/** A variable that is set but empty counts as unset, which is how compose passes an absent value. */
function withoutEmpty(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
}

function pathOrNull(value: string | undefined): string | null {
  return value ? resolve(value) : null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.parse(withoutEmpty(env));
  const dataDir = resolve(parsed.KICKROCKS_DATA_DIR);
  return {
    dataDir,
    dbPath: resolve(dataDir, "kickrocks.db"),
    keyPath: resolve(dataDir, "db.key"),
    host: parsed.KICKROCKS_HOST,
    port: parsed.KICKROCKS_PORT,
    webDist: pathOrNull(parsed.KICKROCKS_WEB_DIST),
    publicUrl: (parsed.KICKROCKS_PUBLIC_URL ?? `http://localhost:${parsed.KICKROCKS_PORT}`).replace(
      /\/+$/,
      "",
    ),
    workerToken: parsed.KICKROCKS_WORKER_TOKEN ?? null,
    extraTargetsPath: pathOrNull(parsed.KICKROCKS_EXTRA_TARGETS),
    extraRecipesDir: pathOrNull(parsed.KICKROCKS_EXTRA_RECIPES),
    schedulerEnabled: parsed.KICKROCKS_SCHEDULER === "on",
    logLevel: parsed.LOG_LEVEL,
    env: parsed.NODE_ENV,
  };
}
