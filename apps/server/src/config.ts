import { resolve } from "node:path";
import { WebUrl } from "@kickrocks/shared";
import { z } from "zod";

/** The pause between sends that keeps a mail provider from flagging a burst. */
export const DEFAULT_SEND_GAP_MS = { min: 20_000, max: 60_000 } as const;

const Env = z.object({
  KICKROCKS_DATA_DIR: z.string().default("./data"),
  KICKROCKS_HOST: z.string().default("127.0.0.1"),
  KICKROCKS_PORT: z.coerce.number().int().positive().default(8420),
  KICKROCKS_WEB_DIST: z.string().optional(),
  KICKROCKS_PUBLIC_URL: WebUrl.optional(),
  KICKROCKS_WORKER_TOKEN: z
    .string()
    .min(16, "KICKROCKS_WORKER_TOKEN must be at least 16 characters")
    .optional(),
  KICKROCKS_EXTRA_TARGETS: z.string().optional(),
  KICKROCKS_EXTRA_RECIPES: z.string().optional(),
  KICKROCKS_ALLOWED_HOSTS: z.string().optional(),
  KICKROCKS_TRUST_PROXY: z.string().default("off"),
  KICKROCKS_SCHEDULER: z.enum(["on", "off"]).default("on"),
  KICKROCKS_ALLOW_PRIVATE_LINK_HOSTS: z.string().optional(),
  KICKROCKS_PLAINTEXT_MAIL_HOSTS: z.string().optional(),
  KICKROCKS_SEND_GAP_MS: z
    .string()
    .regex(/^\d+(-\d+)?$/, 'KICKROCKS_SEND_GAP_MS must be "<ms>" or "<min>-<max>"')
    .optional(),
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
  /**
   * Hostnames besides loopback, IP addresses, and the public URL that the server accepts in a
   * request's Host header, for a name that reaches it through a proxy or the local network.
   */
  allowedHosts: string[];
  /**
   * Which proxies to believe X-Forwarded-* headers from: `false`, a count of proxy hops, or a list
   * of proxy addresses. Believing every hop would let a client choose its own address with a forged
   * header and dodge the login throttle, so a bare "on" is refused.
   */
  trustProxy: false | number | string[];
  schedulerEnabled: boolean;
  /**
   * The random pause between two sends from one mailbox. The default of 20 to 60 seconds keeps a
   * provider from flagging a burst; the development stack shortens it so a suite does not wait.
   */
  sendGapMs: { min: number; max: number };
  mail: {
    /**
     * Hostnames the mailbox may reach without TLS, besides this machine. Empty by default, so a
     * password never crosses a network in the clear; the development stack lists its GreenMail container.
     */
    plaintextHosts: string[];
  };
  linkFollower: {
    /**
     * Hostnames the link follower may reach even though they resolve to a private or loopback
     * address. Empty by default; the end-to-end suite lists its fixture broker site here.
     */
    allowedPrivateHosts: string[];
  };
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

/** A comma separated list of hostnames, lower cased, with blanks dropped. */
function hostList(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean);
}

const PROXY_ADDRESS = /^[0-9a-f:.]+(\/\d{1,3})?$/i;

function proxyTrust(value: string): Config["trustProxy"] {
  const text = value.trim().toLowerCase();
  if (text === "off") return false;
  if (/^\d+$/.test(text)) {
    const hops = Number(text);
    return hops === 0 ? false : hops;
  }
  const addresses = text
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  if (addresses.length > 0 && addresses.every((address) => PROXY_ADDRESS.test(address))) {
    return addresses;
  }
  throw new Error(
    "KICKROCKS_TRUST_PROXY must be off, the number of proxies in front of the server, or a comma separated list of proxy addresses",
  );
}

function gapRange(value: string | undefined): { min: number; max: number } {
  if (value === undefined) return { ...DEFAULT_SEND_GAP_MS };
  const [min = 0, max = min] = value.split("-").map(Number);
  if (min > max) throw new Error("KICKROCKS_SEND_GAP_MS has a minimum above its maximum");
  return { min, max };
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
    allowedHosts: hostList(parsed.KICKROCKS_ALLOWED_HOSTS),
    trustProxy: proxyTrust(parsed.KICKROCKS_TRUST_PROXY),
    schedulerEnabled: parsed.KICKROCKS_SCHEDULER === "on",
    sendGapMs: gapRange(parsed.KICKROCKS_SEND_GAP_MS),
    mail: { plaintextHosts: hostList(parsed.KICKROCKS_PLAINTEXT_MAIL_HOSTS) },
    linkFollower: { allowedPrivateHosts: hostList(parsed.KICKROCKS_ALLOW_PRIVATE_LINK_HOSTS) },
    logLevel: parsed.LOG_LEVEL,
    env: parsed.NODE_ENV,
  };
}
