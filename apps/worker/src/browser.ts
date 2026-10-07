import { existsSync, lstatSync, readlinkSync, rmSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { type BrowserContext, chromium, type Page } from "playwright";
import { describeError, type Logger } from "./logger.js";

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
  /** A specific binary; otherwise the installed Chrome, otherwise Playwright's Chromium. */
  executablePath: string | null;
}

export type BrowserLauncher = (settings: BrowserSettings) => Promise<BrowserContext>;

export const launchPersistentChrome: BrowserLauncher = async (settings) => {
  clearStaleProfileLock(settings.profileDir);
  const executablePath = settings.executablePath ?? findInstalledChrome();
  try {
    return await chromium.launchPersistentContext(settings.profileDir, {
      headless: settings.headless,
      ...(executablePath ? { executablePath } : {}),
      ...(settings.noSandbox ? { args: ["--no-sandbox"] } : {}),
      viewport: { width: 1366, height: 850 },
      locale: "en-US",
      acceptDownloads: false,
    });
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
