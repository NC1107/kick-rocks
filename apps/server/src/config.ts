import { resolve } from "node:path";
import { z } from "zod";

const Env = z.object({
  KICKROCKS_DATA_DIR: z.string().default("./data"),
  KICKROCKS_HOST: z.string().default("127.0.0.1"),
  KICKROCKS_PORT: z.coerce.number().int().positive().default(8420),
  KICKROCKS_WEB_DIST: z.string().optional(),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal"]).default("info"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

export interface Config {
  dataDir: string;
  dbPath: string;
  keyPath: string;
  host: string;
  port: number;
  webDist: string | null;
  logLevel: z.infer<typeof Env>["LOG_LEVEL"];
  env: z.infer<typeof Env>["NODE_ENV"];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = Env.parse(env);
  const dataDir = resolve(parsed.KICKROCKS_DATA_DIR);
  return {
    dataDir,
    dbPath: resolve(dataDir, "kickrocks.db"),
    keyPath: resolve(dataDir, "db.key"),
    host: parsed.KICKROCKS_HOST,
    port: parsed.KICKROCKS_PORT,
    webDist: parsed.KICKROCKS_WEB_DIST ? resolve(parsed.KICKROCKS_WEB_DIST) : null,
    logLevel: parsed.LOG_LEVEL,
    env: parsed.NODE_ENV,
  };
}
