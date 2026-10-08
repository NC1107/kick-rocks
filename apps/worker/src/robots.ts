import type { Page } from "playwright";
import { describeError, type Logger } from "./logger.js";

const MAX_CRAWL_DELAY_SECONDS = 3600;
const ROBOTS_TIMEOUT_MS = 8_000;
const CACHE_MS = 24 * 60 * 60 * 1000;

/**
 * The Crawl-delay the site's robots.txt sets for every crawler, in seconds. A group that names
 * `*` among its user agents counts, and a delay that is not a plain non-negative number is
 * ignored. The directive is not part of the robots standard, but sites that set it mean it.
 */
export function parseCrawlDelay(robots: string): number | undefined {
  let agents: string[] = [];
  let collectingAgents = false;
  let delay: number | undefined;
  for (const raw of robots.split(/\r?\n/)) {
    const line = (raw.split("#")[0] ?? "").trim();
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();
    if (field === "user-agent") {
      agents = collectingAgents ? [...agents, value.toLowerCase()] : [value.toLowerCase()];
      collectingAgents = true;
      continue;
    }
    collectingAgents = false;
    if (field === "crawl-delay" && agents.includes("*") && /^\d+(\.\d+)?$/.test(value)) {
      delay = Math.min(Number(value), MAX_CRAWL_DELAY_SECONDS);
    }
  }
  return delay;
}

export interface CrawlDelayReader {
  /** The delay the site asks for, or undefined when it sets none or robots.txt cannot be read. */
  read(page: Page, origin: string): Promise<number | undefined>;
}

/**
 * Reads robots.txt once a day per site, as any well-behaved crawler does, and remembers the
 * answer. A site with no robots.txt, or one that cannot be reached, simply sets no delay: the
 * reader never makes a failed fetch the task's problem.
 */
export function createCrawlDelayReader(
  logger: Logger,
  now: () => number = Date.now,
): CrawlDelayReader {
  const cache = new Map<string, { delay: number | undefined; expires: number }>();
  return {
    async read(page, origin) {
      const cached = cache.get(origin);
      if (cached && cached.expires > now()) return cached.delay;
      let delay: number | undefined;
      try {
        const response = await page.request.get(`${origin}/robots.txt`, {
          timeout: ROBOTS_TIMEOUT_MS,
          failOnStatusCode: false,
        });
        if (response.ok()) delay = parseCrawlDelay(await response.text());
      } catch (error) {
        logger.debug("could not read robots.txt", { origin, error: describeError(error) });
      }
      cache.set(origin, { delay, expires: now() + CACHE_MS });
      return delay;
    },
  };
}
