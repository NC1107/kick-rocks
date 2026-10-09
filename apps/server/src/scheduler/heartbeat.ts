import type { Config } from "../config.js";
import type { Logger } from "../core/logger.js";

/** A minute is often enough for a monitor whose grace period is minutes, and rare enough to be polite to a shared service. */
export const HEARTBEAT_EVERY_MS = 60 * 1000;
const TIMEOUT_MS = 10_000;

export interface Heartbeat {
  /** Requests the address once. Never throws: a monitor that is down must not stop the scheduler. */
  ping(): Promise<void>;
}

/**
 * Pings the dead-man's-switch address at the end of a scheduler pass, so an outside service raises
 * the alarm when the pings stop. The address is a secret in most services, so it is never logged.
 */
export function createHeartbeat(
  { heartbeatUrl }: Pick<Config, "heartbeatUrl">,
  logger: Logger,
  fetchImpl: typeof fetch = fetch,
): Heartbeat | null {
  if (heartbeatUrl === null) return null;
  return {
    async ping() {
      try {
        const response = await fetchImpl(heartbeatUrl, {
          method: "GET",
          redirect: "error",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        if (!response.ok)
          logger.warn({ status: response.status }, "the heartbeat address refused the ping");
      } catch (error) {
        logger.warn(
          { reason: error instanceof Error ? error.name : "error" },
          "could not ping the heartbeat address",
        );
      }
    },
  };
}
