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
    // If the page has a CF Turnstile container but its iframe hasn't loaded yet, wait for it
    // so the snapshot can report the challenge widget (and the agent knows to solve it).
    try {
      const hasTurnstileContainer = (await page.evaluate(
        "Boolean(document.querySelector('.cf-turnstile, [data-cf-turnstile]'))",
      )) as boolean;
      if (hasTurnstileContainer) {
        await page
          .waitForSelector("iframe[src*='challenges.cloudflare.com']", { timeout: 5_000 })
          .catch(() => {});
      }
    } catch {
      // best-effort; never block a snapshot on this check
    }

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

  /**
   * Attempts to solve an embedded Cloudflare Turnstile widget on the current page by clicking the
   * checkbox inside the Turnstile iframe and waiting for the cf-turnstile-response token to appear.
   * Returns a JSON string describing the outcome so the agent can decide whether to proceed.
   */
  async solveTurnstile(): Promise<string> {
    const page = await this.getPage();
    const CF_URL = /challenges\.cloudflare\.com/;

    // Wait up to 8 s for the iframe to be present if not yet loaded.
    let frame = page.frames().find((f) => CF_URL.test(f.url()));
    if (!frame) {
      try {
        await page.waitForSelector("iframe[src*='challenges.cloudflare.com']", { timeout: 8_000 });
        frame = page.frames().find((f) => CF_URL.test(f.url()));
      } catch {
        return JSON.stringify({
          ok: false,
          reason: "no_turnstile",
          message: "No Cloudflare Turnstile iframe found on this page.",
        });
      }
    }
    if (!frame) {
      return JSON.stringify({
        ok: false,
        reason: "no_turnstile",
        message: "Turnstile iframe in DOM but not yet navigated.",
      });
    }

    // Let the iframe finish loading before interacting.
    await frame.waitForLoadState("load", { timeout: 5_000 }).catch(() => {});

    // Click the Turnstile checkbox (visible for managed/interactive challenges).
    // For fully invisible challenges this may fail, but the background signal still runs.
    try {
      await frame.locator("input[type='checkbox']").click({ timeout: 5_000 });
    } catch {
      // No visible checkbox - the challenge may be invisible and auto-passing.
    }

    // Wait for the parent page to receive the cf-turnstile-response token (up to 15 s).
    try {
      await page.waitForFunction(
        "() => { const el = document.querySelector(\"[name='cf-turnstile-response']\"); return el !== null && el.value.length > 0; }",
        { timeout: 15_000 },
      );
      return JSON.stringify({
        ok: true,
        message: "Turnstile solved - token generated, form is ready to submit.",
      });
    } catch {
      return JSON.stringify({
        ok: "pending",
        message:
          "Turnstile clicked but token not yet generated. A visual CAPTCHA may need manual solving, or the challenge may auto-pass on form submit. Try submitting anyway.",
      });
    }
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
