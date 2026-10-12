import type { BrowserContext, Page } from "playwright";
import { bypassServiceWorkers, launchBrowser } from "./browser.js";
import type { StealthBrowserConfig } from "./config.js";
import { formatSnapshot, type RawSnapshot, READ_SNAPSHOT } from "./snapshot.js";

const NAVIGATION_TIMEOUT_MS = 30_000;
const ACTION_TIMEOUT_MS = 10_000;
const SETTLE_TIMEOUT_MS = 5_000;

/**
 * A persistent browser session for MCP-agent use.
 * A single page is reused across calls; call reset() to open a fresh page.
 */
export class StealthSession {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private starting: Promise<BrowserContext> | null = null;

  constructor(private readonly config: StealthBrowserConfig) {}

  private async getContext(): Promise<BrowserContext> {
    if (this.context) return this.context;
    if (this.starting) return this.starting;
    this.starting = this.launch();
    const ctx = await this.starting;
    this.starting = null;
    return ctx;
  }

  private async launch(): Promise<BrowserContext> {
    const context = await launchBrowser(this.config);
    context.on("close", () => {
      if (this.context === context) {
        this.context = null;
        this.page = null;
      }
    });
    this.context = context;
    return context;
  }

  private async getPage(): Promise<Page> {
    const context = await this.getContext();
    if (this.page && !this.page.isClosed()) return this.page;
    const page = await context.newPage();
    await bypassServiceWorkers(page);
    this.page = page;
    return page;
  }

  private async settle(page: Page): Promise<void> {
    await page.waitForLoadState("domcontentloaded", { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
    await page.waitForLoadState("load", { timeout: SETTLE_TIMEOUT_MS }).catch(() => {});
  }

  private async readSnapshot(page: Page, part: number): Promise<string> {
    let raw: RawSnapshot;
    try {
      raw = await page.evaluate<RawSnapshot>(READ_SNAPSHOT);
    } catch {
      await this.settle(page);
      raw = await page.evaluate<RawSnapshot>(READ_SNAPSHOT);
    }
    return formatSnapshot(raw, { part });
  }

  async navigate(url: string): Promise<string> {
    const page = await this.getPage();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
    await this.settle(page);
    return this.readSnapshot(page, 1);
  }

  async snapshot(part: number = 1): Promise<string> {
    const page = await this.getPage();
    return this.readSnapshot(page, part);
  }

  async click(ref: string): Promise<string> {
    const page = await this.getPage();
    await page.locator(`[data-kr-ref="${ref}"]`).click({ timeout: ACTION_TIMEOUT_MS });
    await this.settle(page);
    return this.readSnapshot(page, 1);
  }

  async fill(ref: string, text: string): Promise<string> {
    const page = await this.getPage();
    await page.locator(`[data-kr-ref="${ref}"]`).fill(text, { timeout: ACTION_TIMEOUT_MS });
    return this.readSnapshot(page, 1);
  }

  async select(ref: string, value: string): Promise<string> {
    const page = await this.getPage();
    await page
      .locator(`[data-kr-ref="${ref}"]`)
      .selectOption(value, { timeout: ACTION_TIMEOUT_MS });
    return this.readSnapshot(page, 1);
  }

  async screenshot(): Promise<Buffer> {
    const page = await this.getPage();
    return page.screenshot({ type: "png" });
  }

  async reset(): Promise<void> {
    if (this.page && !this.page.isClosed()) {
      await this.page.close().catch(() => {});
    }
    this.page = null;
  }

  async close(): Promise<void> {
    await this.reset();
    if (this.context) {
      await this.context.close().catch(() => {});
      this.context = null;
    }
  }
}
