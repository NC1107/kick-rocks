import type { Page } from "playwright";
import { describe, expect, it, vi } from "vitest";
import { createCrawlDelayReader, parseCrawlDelay } from "../src/robots.js";
import { silentLogger } from "./support.js";

describe("parseCrawlDelay", () => {
  it("reads the delay of the group for every crawler", () => {
    expect(
      parseCrawlDelay("User-agent: Googlebot\nCrawl-delay: 1\n\nUser-agent: *\nCrawl-delay: 10\n"),
    ).toBe(10);
  });

  it("counts a group that lists * among several user agents", () => {
    expect(parseCrawlDelay("User-agent: bingbot\nUser-agent: *\nCrawl-delay: 5")).toBe(5);
  });

  it("ignores the delay of a group for one named crawler", () => {
    expect(parseCrawlDelay("User-agent: ahrefsbot\nCrawl-delay: 30\n")).toBeUndefined();
  });

  it("accepts a fraction, comments, and any letter case", () => {
    expect(parseCrawlDelay("USER-AGENT: *   # everyone\ncrawl-delay: 2.5 # seconds\n")).toBe(2.5);
  });

  it("ignores a delay that is not a plain number and caps an absurd one", () => {
    expect(parseCrawlDelay("User-agent: *\nCrawl-delay: soon")).toBeUndefined();
    expect(parseCrawlDelay("User-agent: *\nCrawl-delay: -4")).toBeUndefined();
    expect(parseCrawlDelay("User-agent: *\nCrawl-delay: 999999")).toBe(3600);
  });

  it("says nothing for a robots.txt without one", () => {
    expect(parseCrawlDelay("User-agent: *\nDisallow: /admin\n")).toBeUndefined();
    expect(parseCrawlDelay("")).toBeUndefined();
  });
});

describe("the crawl delay reader", () => {
  function pageAnswering(body: string, ok = true) {
    const get = vi.fn(async () => ({ ok: () => ok, text: async () => body }));
    return { page: { request: { get } } as unknown as Page, get };
  }

  it("reads robots.txt once a day per site", async () => {
    let clock = 0;
    const reader = createCrawlDelayReader(silentLogger, () => clock);
    const { page, get } = pageAnswering("User-agent: *\nCrawl-delay: 7");
    expect(await reader.read(page, "https://broker.test")).toBe(7);
    expect(await reader.read(page, "https://broker.test")).toBe(7);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith("https://broker.test/robots.txt", expect.anything());

    clock += 25 * 60 * 60 * 1000;
    await reader.read(page, "https://broker.test");
    expect(get).toHaveBeenCalledTimes(2);
  });

  it("treats a missing robots.txt as no delay, without failing the task", async () => {
    const reader = createCrawlDelayReader(silentLogger);
    expect(await reader.read(pageAnswering("", false).page, "https://a.test")).toBeUndefined();
    const failing = {
      request: {
        get: vi.fn(async () => {
          throw new Error("net::ERR_CONNECTION_REFUSED");
        }),
      },
    } as unknown as Page;
    expect(await reader.read(failing, "https://b.test")).toBeUndefined();
  });
});
