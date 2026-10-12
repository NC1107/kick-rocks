import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import type { StealthBrowserConfig } from "./config.js";

function findChrome(): string | null {
  const paths =
    process.platform === "darwin"
      ? ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"]
      : ["/opt/google/chrome/chrome", "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"];
  return paths.find((p) => existsSync(p)) ?? null;
}

function prepareProfile(profileDir: string): void {
  mkdirSync(profileDir, { recursive: true });
  // Container restarts get a new hostname, so Chrome refuses the old SingletonLock. Always clear it.
  for (const f of ["SingletonLock", "SingletonSocket", "SingletonCookie"]) {
    rmSync(join(profileDir, f), { force: true });
  }
  // Disable network prediction so speculation rules cannot prefetch URLs outside the request gate.
  const prefsFile = join(profileDir, "Default", "Preferences");
  let prefs: Record<string, unknown> = {};
  try {
    const raw: unknown = JSON.parse(readFileSync(prefsFile, "utf8"));
    if (raw !== null && typeof raw === "object" && !Array.isArray(raw)) {
      prefs = raw as Record<string, unknown>;
    }
  } catch {
    // first run or unreadable - start fresh
  }
  const net = prefs["net"];
  prefs["net"] = {
    ...(net !== null && typeof net === "object" && !Array.isArray(net) ? net : {}),
    network_prediction_options: 2,
  };
  mkdirSync(join(profileDir, "Default"), { recursive: true });
  writeFileSync(prefsFile, JSON.stringify(prefs));
  // Purge cached service workers so none can intercept the first navigation of a new session.
  for (const sw of [join("Default", "Service Worker"), "Service Worker"]) {
    rmSync(join(profileDir, sw), { recursive: true, force: true });
  }
}

export async function launchBrowser(config: StealthBrowserConfig): Promise<BrowserContext> {
  prepareProfile(config.chromeProfileDir);
  const args = [
    "--remote-debugging-port=0",
    "--disable-blink-features=AutomationControlled",
    "--disable-features=Prerender2,Reporting,NetworkErrorLogging,FedCm,WebPayments",
    ...(config.noSandbox ? ["--no-sandbox"] : []),
    ...(config.proxyServer
      ? [
          "--webrtc-ip-handling-policy=disable_non_proxied_udp",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        ]
      : []),
  ];
  const chrome = findChrome();
  return chromium.launchPersistentContext(config.chromeProfileDir, {
    headless: config.headless,
    ...(chrome ? { executablePath: chrome } : {}),
    args,
    ...(config.proxyServer ? { proxy: { server: config.proxyServer } } : {}),
    viewport: { width: 1366, height: 850 },
    locale: "en-US",
    acceptDownloads: false,
    serviceWorkers: "block",
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });
}

export async function bypassServiceWorkers(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setBypassServiceWorker", { bypass: true });
}
