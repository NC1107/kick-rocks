import { lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type BrowserSession,
  clearStaleProfileLock,
  createBrowserSession,
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
