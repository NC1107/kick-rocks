import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Config } from "../config.js";
import type { SettingsStore } from "./settings.js";

const TOKEN_BYTES = 32;

export function generateToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Compares two strings without leaking where they differ or how long they are, by comparing
 * fixed-length digests rather than the values themselves.
 */
export function safeEqual(a: string, b: string): boolean {
  const left = createHash("sha256").update(a).digest();
  const right = createHash("sha256").update(b).digest();
  return timingSafeEqual(left, right);
}

/** The token from an `Authorization: Bearer <token>` header, or null when absent or malformed. */
export function bearerToken(header: string | string[] | undefined): string | null {
  if (typeof header !== "string") return null;
  const match = /^Bearer +(\S+)$/i.exec(header.trim());
  return match ? (match[1] as string) : null;
}

/** `disabled` means the endpoint is switched off, which is different from a wrong token. */
export type TokenCheck = "ok" | "invalid" | "disabled";

export interface Secrets {
  generateToken(): string;
  hashToken(token: string): string;
  safeEqual(a: string, b: string): boolean;
  bearerToken(header: string | string[] | undefined): string | null;
  checkWorkerToken(header: string | string[] | undefined): TokenCheck;
  checkMcpToken(header: string | string[] | undefined): TokenCheck;
  /** Makes a new MCP token, stores only its hash, and returns the token to show once. */
  rotateMcpToken(): string;
}

export function createSecrets(
  config: Pick<Config, "workerToken">,
  settings: SettingsStore,
): Secrets {
  return {
    generateToken,
    hashToken,
    safeEqual,
    bearerToken,

    checkWorkerToken(header) {
      if (config.workerToken === null) return "disabled";
      const presented = bearerToken(header);
      return presented !== null && safeEqual(presented, config.workerToken) ? "ok" : "invalid";
    },

    checkMcpToken(header) {
      const storedHash = settings.get("mcp.tokenHash");
      if (!settings.get("mcp.enabled") || storedHash === null) return "disabled";
      const presented = bearerToken(header);
      return presented !== null && safeEqual(hashToken(presented), storedHash) ? "ok" : "invalid";
    },

    rotateMcpToken() {
      const token = generateToken();
      settings.set("mcp.tokenHash", hashToken(token));
      return token;
    },
  };
}
