import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, type Page } from "playwright";
import { describeError, type Logger } from "./logger.js";
import {
  bypassServiceWorkersBeforeTabsRun,
  forgetDevToolsEndpoint,
  type TabGuard,
  type TabGuardOptions,
} from "./tab-guard.js";

/** Where Chrome installs itself, in the order to prefer them. */
export function installedChromePaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  if (platform === "darwin") {
    return ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"];
  }
  if (platform === "win32") {
    return [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]
      .filter((root): root is string => Boolean(root))
      .map((root) => join(root, "Google", "Chrome", "Application", "chrome.exe"));
  }
  return ["/opt/google/chrome/chrome", "/usr/bin/google-chrome-stable", "/usr/bin/google-chrome"];
}

/**
 * The Chrome installed on this machine, or null. Real Chrome is preferred because bot checks treat
 * it as an ordinary visitor far more often than a bundled Chromium build.
 */
export function findInstalledChrome(
  exists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return installedChromePaths(platform, env).find(exists) ?? null;
}

const LOCK_FILES = ["SingletonLock", "SingletonSocket", "SingletonCookie"];

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export interface LockCheck {
  hostname?: string;
  isAlive?: (pid: number) => boolean;
}

/**
 * Chrome leaves `SingletonLock` (a link named `<host>-<pid>`) in its profile. A container that is
 * recreated gets a new host name, and Chrome then refuses a profile it believes belongs to another
 * computer, so a lock from another host, or from a process that is gone, is removed. A lock held by
 * a live process on this host is left alone, which keeps two workers off one profile.
 */
export function clearStaleProfileLock(profileDir: string, check: LockCheck = {}): boolean {
  const lock = join(profileDir, "SingletonLock");
  let target: string;
  try {
    if (!lstatSync(lock).isSymbolicLink()) return false;
    target = readlinkSync(lock);
  } catch {
    return false;
  }
  const separator = target.lastIndexOf("-");
  const host = target.slice(0, separator);
  const pid = Number.parseInt(target.slice(separator + 1), 10);
  const sameHost = host === (check.hostname ?? hostname());
  const alive = sameHost && Number.isInteger(pid) && (check.isAlive ?? processIsAlive)(pid);
  if (alive) return false;
  for (const name of LOCK_FILES) rmSync(join(profileDir, name), { force: true });
  return true;
}

export interface BrowserSettings {
  profileDir: string;
  headless: boolean;
  noSandbox: boolean;
  /** An http proxy for all of the browser's traffic; null connects directly. */
  proxyServer?: string | null;
  /** A specific binary; otherwise the installed Chrome, otherwise Playwright's Chromium. */
  executablePath: string | null;
}

export type BrowserLauncher = (settings: BrowserSettings) => Promise<BrowserContext>;

/**
 * Playwright's own block only replaces `navigator.serviceWorker.register`, so a page can still reach
 * the real one, and it does nothing for a worker an earlier visit left in the profile. A worker
 * that another site registered would answer a navigation before the navigation guard ever saw it,
 * and could forward a form. The launcher therefore also deletes the profile's worker storage, and
 * every page is told to bypass service workers.
 */
export const BROWSER_CONTEXT_OPTIONS = {
  viewport: { width: 1366, height: 850 },
  locale: "en-US",
  acceptDownloads: false,
  serviceWorkers: "block",
} as const;

const SERVICE_WORKER_STORAGE = [join("Default", "Service Worker"), "Service Worker"];

/** Deletes every service worker a profile remembers, so none can answer a request in this run. */
export function clearServiceWorkerStorage(profileDir: string): void {
  for (const path of SERVICE_WORKER_STORAGE) {
    rmSync(join(profileDir, path), { recursive: true, force: true });
  }
}

/** Keeps a page, and so every request it makes, away from service workers. */
export async function bypassServiceWorkers(page: Page): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setBypassServiceWorker", { bypass: true });
}

/**
 * A page made through `newPage` is bypassed before it is handed out, so its first navigation is
 * already clear of workers. A page a site opens is bypassed as soon as it appears, but that is
 * after it started, so the tab guard also refuses to let any service worker install.
 */
function bypassOnEveryPage(context: BrowserContext): void {
  const bypass = (page: Page): void => {
    bypassServiceWorkers(page).catch(() => undefined);
  };
  for (const page of context.pages()) bypass(page);
  context.on("page", bypass);
  const newPage = context.newPage.bind(context);
  context.newPage = async () => {
    const page = await newPage();
    await bypassServiceWorkers(page);
    return page;
  };
}

const tabGuards = new WeakMap<BrowserContext, TabGuard>();

/**
 * The browser stays up across tasks, so a worker that one task's site registered would still be
 * there for the next. Call it between tasks.
 */
export async function clearServiceWorkers(context: BrowserContext): Promise<void> {
  await tabGuards.get(context)?.clearServiceWorkers();
}

/**
 * Chrome announces itself as automated through `navigator.webdriver` whenever it is driven over
 * the DevTools protocol, and bot management reads that flag first. This switch is what a person's
 * own Chrome has by default, so the visitor looks like one.
 *
 * Over a proxy, WebRTC would otherwise let a page read the home address from STUN candidates,
 * because UDP does not go through an http proxy.
 */
export function chromeArgs(settings: Pick<BrowserSettings, "noSandbox" | "proxyServer">): string[] {
  return [
    "--remote-debugging-port=0",
    "--disable-blink-features=AutomationControlled",
    ...(settings.noSandbox ? ["--no-sandbox"] : []),
    ...(settings.proxyServer
      ? [
          "--webrtc-ip-handling-policy=disable_non_proxied_udp",
          "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
        ]
      : []),
  ];
}

export const launchPersistentChrome = async (
  settings: BrowserSettings,
  guardOptions: TabGuardOptions = {},
): Promise<BrowserContext> => {
  clearStaleProfileLock(settings.profileDir);
  clearServiceWorkerStorage(settings.profileDir);
  forgetDevToolsEndpoint(settings.profileDir);
  const executablePath = settings.executablePath ?? findInstalledChrome();
  try {
    const context = await chromium.launchPersistentContext(settings.profileDir, {
      headless: settings.headless,
      ...(executablePath ? { executablePath } : {}),
      args: chromeArgs(settings),
      ...(settings.proxyServer ? { proxy: { server: settings.proxyServer } } : {}),
      ...BROWSER_CONTEXT_OPTIONS,
    });
    bypassOnEveryPage(context);
    try {
      const guard = await bypassServiceWorkersBeforeTabsRun(settings.profileDir, guardOptions);
      tabGuards.set(context, guard);
      context.on("close", () => guard.close());
    } catch (error) {
      await context.close().catch(() => undefined);
      throw error;
    }
    return context;
  } catch (error) {
    const message = describeError(error);
    if (/already in use|ProcessSingleton|profile.*in use/i.test(message)) {
      throw new Error(
        `The Chrome profile at ${settings.profileDir} is already in use. Run one worker per profile.`,
      );
    }
    throw error;
  }
};

/** Hands out pages from one persistent Chrome, starting it on first use and again after a crash. */
export interface BrowserSession {
  newPage(): Promise<Page>;
  /** Closes the browser, which fails anything still running in it. */
  close(): Promise<void>;
}

export function createBrowserSession(
  settings: BrowserSettings,
  logger: Logger,
  launch: BrowserLauncher = launchPersistentChrome,
): BrowserSession {
  let context: BrowserContext | null = null;
  let starting: Promise<BrowserContext> | null = null;

  async function start(): Promise<BrowserContext> {
    logger.info("starting the browser", {
      headless: settings.headless,
      executable: settings.executablePath ?? findInstalledChrome() ?? "playwright chromium",
    });
    const started = await launch(settings);
    started.on("close", () => {
      if (context === started) context = null;
    });
    // Closing the last tab of a headed Chrome quits it, so one blank tab stays open between tasks.
    if (started.pages().length === 0) await started.newPage();
    context = started;
    return started;
  }

  function ensure(): Promise<BrowserContext> {
    if (context) return Promise.resolve(context);
    starting ??= start().finally(() => {
      starting = null;
    });
    return starting;
  }

  return {
    async newPage() {
      const current = await ensure();
      try {
        await clearServiceWorkers(current).catch((error: unknown) => {
          logger.warn("could not remove service workers between tasks", {
            error: describeError(error),
          });
        });
        return await current.newPage();
      } catch (error) {
        logger.warn("the browser stopped responding, restarting it", {
          error: describeError(error),
        });
        if (context === current) context = null;
        await current.close().catch(() => undefined);
        return (await ensure()).newPage();
      }
    },
    async close() {
      const current = context ?? (await starting?.catch(() => null)) ?? null;
      context = null;
      await current?.close().catch(() => undefined);
    },
  };
}

/** Where canaries run, with no person's cookies or logins in it. */
const SHARED_SCOPE = "shared";
const SAFE_SCOPE = /^[A-Za-z0-9_-]{1,64}$/;

/** A folder name for a profile id, hashed when the id is not already safe to use as one. */
function scopeName(profileId: string | null): string {
  if (profileId === null) return SHARED_SCOPE;
  return SAFE_SCOPE.test(profileId)
    ? profileId
    : `h-${createHash("sha256").update(profileId).digest("hex").slice(0, 32)}`;
}

/**
 * One persistent Chrome per Kick Rocks profile. Cookies and storage are what let a broker tie two
 * visits together, so the people on one instance must never share them. Browsers start on first use.
 */
export interface ProfileBrowsers {
  /**
   * A page in the person's browser. A proxy given here is used for the page's traffic. Each route
   * has its own user data folder, so cookies from a direct visit never meet the proxy's address.
   * A worker started with a proxy of its own refuses a different one with `ProxyConflictError`.
   * Changing route restarts that profile's browser, so it happens between tasks.
   */
  newPage(profileId: string | null, proxy?: string | null): Promise<Page>;
  /**
   * Forgets every profile that is not in the list: closes its browser and deletes its cookies,
   * history and cached pages. A profile that was deleted must not leave a record of its visits
   * behind. Call it only between tasks, because it closes browsers that may be in use.
   */
  keepOnly(profileIds: readonly string[]): Promise<void>;
  close(): Promise<void>;
}

/**
 * The person routed a site through a proxy, but this worker was started with a proxy of its own,
 * which always wins. Going on would send the visit through the wrong route without saying so.
 */
export class ProxyConflictError extends Error {
  override name = "ProxyConflictError";

  constructor() {
    super(
      "This site is routed through a proxy in Settings, but this worker was started with its own proxy (KICKROCKS_WORKER_PROXY), which cannot be combined with it. Remove one of the two.",
    );
  }
}

/** A folder name for a route, so the identity a site sees through one address never shares storage with another. */
function routeName(proxy: string | null): string {
  return proxy === null
    ? "direct"
    : `via-${createHash("sha256").update(proxy).digest("hex").slice(0, 16)}`;
}

export function createProfileBrowsers(
  settings: BrowserSettings,
  logger: Logger,
  launch: BrowserLauncher = launchPersistentChrome,
): ProfileBrowsers {
  const sessions = new Map<string, { session: BrowserSession; proxy: string | null }>();

  async function sessionFor(profileId: string | null, requested: string | null) {
    const scope = scopeName(profileId);
    if (requested !== null && settings.proxyServer && requested !== settings.proxyServer) {
      throw new ProxyConflictError();
    }
    const proxy = settings.proxyServer ?? requested;
    const open = sessions.get(scope);
    if (open && open.proxy === proxy) return open.session;
    if (open) {
      sessions.delete(scope);
      await open.session.close();
    }
    const profileDir = join(settings.profileDir, "kickrocks", scope, routeName(proxy));
    mkdirSync(profileDir, { recursive: true });
    const session = createBrowserSession(
      { ...settings, profileDir, proxyServer: proxy },
      logger,
      launch,
    );
    sessions.set(scope, { session, proxy });
    return session;
  }

  return {
    newPage: async (profileId, proxy = null) => (await sessionFor(profileId, proxy)).newPage(),
    async keepOnly(profileIds) {
      const kept = new Set([SHARED_SCOPE, ...profileIds.map(scopeName)]);
      for (const [scope, open] of [...sessions]) {
        if (kept.has(scope)) continue;
        sessions.delete(scope);
        await open.session.close();
      }
      const root = join(settings.profileDir, "kickrocks");
      const onDisk = existsSync(root) ? readdirSync(root) : [];
      for (const scope of onDisk.filter((name) => !kept.has(name))) {
        rmSync(join(root, scope), { recursive: true, force: true });
        logger.info("removed the browser data of a profile that no longer exists", { scope });
      }
    },
    async close() {
      const open = [...sessions.values()];
      sessions.clear();
      await Promise.all(open.map(({ session }) => session.close()));
    },
  };
}
