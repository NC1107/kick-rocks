import { type Browser, chromium, type Page } from "playwright";
import { STACK } from "./stack.js";

export const VIEWPORTS = [
  { name: "desktop", width: 1280, height: 900 },
  { name: "phone", width: 390, height: 844 },
] as const;

export const SCHEMES = ["light", "dark"] as const;

/** Uses the Chrome on the machine when there is one, so a run needs no browser download. */
export async function launchBrowser(): Promise<Browser> {
  try {
    return await chromium.launch({ channel: "chrome" });
  } catch {
    return chromium.launch();
  }
}

export interface ScreenReport {
  route: string;
  viewport: string;
  scheme: string;
  /** Pixels the page is wider than the window, which makes the page scroll sideways. */
  overflow: number;
  problems: string[];
}

async function signIn(page: Page, password: string): Promise<void> {
  await page.goto(`${STACK.serverUrl}/login`);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Opens every route the way a person would and reports what is visibly or technically wrong. */
export async function inspectScreens(
  browser: Browser,
  routes: readonly string[],
  password: string,
): Promise<ScreenReport[]> {
  const reports: ScreenReport[] = [];
  for (const viewport of VIEWPORTS) {
    for (const scheme of SCHEMES) {
      const context = await browser.newContext({
        viewport: { width: viewport.width, height: viewport.height },
        colorScheme: scheme,
      });
      const page = await context.newPage();
      try {
        await signIn(page, password);
        let problems: string[] = [];
        page.on("console", (message) => {
          if (message.type() === "error") problems.push(`console: ${message.text()}`);
        });
        page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
        page.on("response", (response) => {
          if (response.status() >= 400) {
            problems.push(`${response.status()} ${response.request().method()} ${response.url()}`);
          }
        });
        for (const route of routes) {
          problems = [];
          await page.goto(`${STACK.serverUrl}${route}`, { waitUntil: "networkidle" });
          const overflow = await page.evaluate<number>(
            "document.documentElement.scrollWidth - window.innerWidth",
          );
          reports.push({
            route,
            viewport: viewport.name,
            scheme,
            overflow,
            problems: [...problems],
          });
        }
      } finally {
        await context.close();
      }
    }
  }
  return reports;
}

const PILL_OFFSETS = `Array.from(document.querySelectorAll("tbody tr")).slice(0, 5).map((row) => {
  const middle = (element) => {
    const box = element && element.getBoundingClientRect();
    return box ? box.top + box.height / 2 : 0;
  };
  return Math.abs(middle(row.children[1] && row.children[1].firstElementChild) - middle(row.children[3]));
})`;

/** How far each request row's status pill sits from the middle of the row's other cells, in pixels. */
export async function statusPillOffsets(page: Page): Promise<number[]> {
  return page.evaluate<number[]>(PILL_OFFSETS);
}
