import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BrowserSession,
  clearStaleProfileLock,
  createBrowserSession,
  createProfileBrowsers,
  findInstalledChrome,
  installedChromePaths,
} from "../src/browser.js";
import { describeBrowser, silentLogger } from "./support.js";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kickrocks-worker-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("finding Chrome", () => {
  it("lists the standard install locations for each platform", () => {
    expect(installedChromePaths("linux")[0]).toBe("/opt/google/chrome/chrome");
    expect(installedChromePaths("darwin")).toEqual([
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    ]);
    expect(
      installedChromePaths("win32", { PROGRAMFILES: "C:\\Program Files", LOCALAPPDATA: "" }),
    ).toHaveLength(1);
  });

  it("uses the first install that exists, and nothing when there is none", () => {
    expect(findInstalledChrome((path) => path.endsWith("google-chrome"), "linux")).toBe(
      "/usr/bin/google-chrome",
    );
    expect(findInstalledChrome(() => false, "linux")).toBeNull();
  });
});

describe("a stale Chrome profile lock", () => {
  function lock(target: string) {
    symlinkSync(target, join(dir, "SingletonLock"));
    symlinkSync("socket", join(dir, "SingletonSocket"));
    writeFileSync(join(dir, "SingletonCookie"), "");
  }
  const exists = (name: string) => {
    try {
      lstatSync(join(dir, name));
      return true;
    } catch {
      return false;
    }
  };

  it("is cleared when it comes from another host, as after a container is recreated", () => {
    lock("old-container-4242");
    expect(clearStaleProfileLock(dir, { hostname: "new-container", isAlive: () => true })).toBe(
      true,
    );
    expect(["SingletonLock", "SingletonSocket", "SingletonCookie"].some(exists)).toBe(false);
  });

  it("is cleared when its process on this host is gone", () => {
    lock("this-host-4242");
    expect(clearStaleProfileLock(dir, { hostname: "this-host", isAlive: () => false })).toBe(true);
    expect(exists("SingletonLock")).toBe(false);
  });

  it("is kept while a process on this host holds it, so two workers never share a profile", () => {
    lock("this-host-4242");
    expect(clearStaleProfileLock(dir, { hostname: "this-host", isAlive: () => true })).toBe(false);
    expect(exists("SingletonLock")).toBe(true);
  });

  it("does nothing when there is no lock or the profile does not exist", () => {
    expect(clearStaleProfileLock(dir)).toBe(false);
    expect(clearStaleProfileLock(join(dir, "missing"))).toBe(false);
  });
});

describeBrowser("the persistent Chrome profile", () => {
  let site: Server;
  let origin: string;
  let session: BrowserSession | null = null;

  beforeAll(async () => {
    site = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        `<!doctype html><title>Fixture</title><p>${request.headers.cookie ?? "no cookie"}</p>`,
      );
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    site.closeAllConnections();
    await new Promise<void>((resolve) => site.close(() => resolve()));
  });

  afterEach(async () => {
    await session?.close();
    session = null;
  });

  function open(profile = join(dir, "profile")): BrowserSession {
    mkdirSync(profile, { recursive: true });
    session = createBrowserSession(
      { profileDir: profile, headless: true, noSandbox: false, executablePath: null },
      silentLogger,
    );
    return session;
  }

  it("opens a page that can load a site", async () => {
    const page = await open().newPage();
    await page.goto(origin);
    expect(await page.textContent("p")).toBe("no cookie");
  });

  it("keeps cookies across restarts, which is what makes bot checks treat it as a returning visitor", async () => {
    const profile = join(dir, "profile");
    const first = open(profile);
    const page = await first.newPage();
    await page.goto(origin);
    await page.context().addCookies([
      {
        name: "visitor",
        value: "returning",
        url: origin,
        expires: Math.floor(Date.now() / 1000) + 3600,
      },
    ]);
    await first.close();

    const second = open(profile);
    const again = await second.newPage();
    await again.goto(origin);
    expect(await again.textContent("p")).toBe("visitor=returning");
  });

  it("starts the browser again when it has gone away", async () => {
    const current = open();
    const page = await current.newPage();
    await page.context().close();
    const replacement = await current.newPage();
    await replacement.goto(origin);
    expect(await replacement.textContent("p")).toBe("no cookie");
  });

  it("starts the browser once when several pages are asked for at once", async () => {
    const current = open();
    const pages = await Promise.all([current.newPage(), current.newPage(), current.newPage()]);
    expect(new Set(pages.map((page) => page.context())).size).toBe(1);
  });

  it("names the problem when another browser holds the profile", async () => {
    const profile = join(dir, "profile");
    const first = open(profile);
    await first.newPage();
    const second = createBrowserSession(
      { profileDir: profile, headless: true, noSandbox: false, executablePath: null },
      silentLogger,
    );
    await expect(second.newPage()).rejects.toThrow(/already in use/);
    await second.close();
  });

  it("closing a session that never started is harmless", async () => {
    await open().close();
  });
});

describe("one browser per Kick Rocks profile", () => {
  function fakeLauncher() {
    const dirs: string[] = [];
    const launch = vi.fn(async (settings: { profileDir: string }) => {
      dirs.push(settings.profileDir);
      const page = {};
      return {
        on: vi.fn(),
        pages: () => [page],
        newPage: async () => page,
        close: async () => undefined,
      } as never;
    });
    return { dirs, launch };
  }
  const settings = () => ({
    profileDir: dir,
    headless: true,
    noSandbox: false,
    executablePath: null,
  });

  it("gives each profile its own user data folder, started once", async () => {
    const { dirs, launch } = fakeLauncher();
    const browsers = createProfileBrowsers(settings(), silentLogger, launch);
    await browsers.newPage("p-one");
    await browsers.newPage("p-two");
    await browsers.newPage("p-one");
    expect(dirs).toEqual([join(dir, "kickrocks", "p-one"), join(dir, "kickrocks", "p-two")]);
  });

  it("keeps canaries and other tasks without a person in a folder of their own", async () => {
    const { dirs, launch } = fakeLauncher();
    await createProfileBrowsers(settings(), silentLogger, launch).newPage(null);
    expect(dirs).toEqual([join(dir, "kickrocks", "shared")]);
  });

  describe("when profiles are deleted", () => {
    const folder = (name: string) => join(dir, "kickrocks", name);

    it("deletes the folders and closes the browsers of profiles that are gone, and keeps the rest", async () => {
      const closed: string[] = [];
      const launch = vi.fn(async (opened: { profileDir: string }) => {
        const page = {};
        return {
          on: vi.fn(),
          pages: () => [page],
          newPage: async () => page,
          close: async () => void closed.push(opened.profileDir),
        } as never;
      });
      const browsers = createProfileBrowsers(settings(), silentLogger, launch);
      await browsers.newPage("p-kept");
      await browsers.newPage("p-gone");
      await browsers.newPage(null);
      mkdirSync(folder("p-old-run"), { recursive: true });
      writeFileSync(join(folder("p-gone"), "Cookies"), "cookie data");

      await browsers.keepOnly(["p-kept"]);

      expect(existsSync(folder("p-gone"))).toBe(false);
      expect(existsSync(folder("p-old-run"))).toBe(false);
      expect(existsSync(folder("p-kept"))).toBe(true);
      expect(existsSync(folder("shared"))).toBe(true);
      expect(closed).toEqual([folder("p-gone")]);

      await browsers.newPage("p-gone");
      expect(launch).toHaveBeenCalledTimes(4);
    });

    it("deletes every profile's folder when none is left, as after a reset", async () => {
      const { launch } = fakeLauncher();
      const browsers = createProfileBrowsers(settings(), silentLogger, launch);
      await browsers.newPage("p-one");
      await browsers.newPage("p-two");
      await browsers.keepOnly([]);
      expect(existsSync(folder("p-one"))).toBe(false);
      expect(existsSync(folder("p-two"))).toBe(false);
    });

    it("finds a hashed folder by the profile id it was made from", async () => {
      const { launch } = fakeLauncher();
      const browsers = createProfileBrowsers(settings(), silentLogger, launch);
      await browsers.newPage("../../etc");
      await browsers.keepOnly(["../../etc"]);
      expect(readdirSync(join(dir, "kickrocks")).some((name) => name.startsWith("h-"))).toBe(true);
      await browsers.keepOnly([]);
      expect(readdirSync(join(dir, "kickrocks")).some((name) => name.startsWith("h-"))).toBe(false);
    });

    it("does nothing when the worker has never opened a browser", async () => {
      const { launch } = fakeLauncher();
      await createProfileBrowsers(settings(), silentLogger, launch).keepOnly([]);
      expect(existsSync(join(dir, "kickrocks"))).toBe(false);
    });
  });

  it("never lets a profile id climb out of the folder", async () => {
    const { dirs, launch } = fakeLauncher();
    await createProfileBrowsers(settings(), silentLogger, launch).newPage("../../etc");
    expect(dirs[0]?.startsWith(join(dir, "kickrocks", "h-"))).toBe(true);
  });
});

describeBrowser("browsers of different profiles", () => {
  let site: Server;
  let origin: string;

  beforeAll(async () => {
    site = createServer((request, response) => {
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        `<!doctype html><title>Fixture</title><p>${request.headers.cookie ?? "no cookie"}</p>`,
      );
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    site.closeAllConnections();
    await new Promise<void>((resolve) => site.close(() => resolve()));
  });

  it("do not share cookies, while each keeps its own", async () => {
    const browsers = createProfileBrowsers(
      { profileDir: dir, headless: true, noSandbox: false, executablePath: null },
      silentLogger,
    );
    try {
      const jordan = await browsers.newPage("p-jordan");
      await jordan.goto(origin);
      await jordan.context().addCookies([{ name: "who", value: "jordan", url: origin }]);

      const sam = await browsers.newPage("p-sam");
      await sam.goto(origin);
      expect(await sam.textContent("p")).toBe("no cookie");

      const again = await browsers.newPage("p-jordan");
      await again.goto(origin);
      expect(await again.textContent("p")).toBe("who=jordan");
    } finally {
      await browsers.close();
    }
  });
});
