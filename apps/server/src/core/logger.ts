import type { FastifyBaseLogger } from "fastify";
import pino from "pino";
import type { Config } from "../config.js";

/** The type Fastify expects, so the same logger serves the server and every service. */
export type Logger = FastifyBaseLogger;

/** Credentials never reach a log line, whichever code path logs the request. */
export function createLogger(config: Pick<Config, "logLevel">): Logger {
  return pino({
    level: config.logLevel,
    redact: ["req.headers.authorization", "req.headers.cookie", "res.headers['set-cookie']"],
  });
}
