import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext } from "playwright";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type BrowserSession,
  chromeArgs,
  clearStaleProfileLock,
  createBrowserSession,
  createProfileBrowsers,
  findInstalledChrome,
  installedChromePaths,
  launchPersistentChrome,
  ProxyConflictError,
  timezoneOption,
  turnOffPreloading,
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

describe("the arguments Chrome starts with", () => {
  it("hides the automation flag, which bot management reads first", () => {
    expect(chromeArgs({ noSandbox: false })).toContain(
      "--disable-blink-features=AutomationControlled",
    );
  });

  it("keeps WebRTC from reading the home address only when a proxy is in use", () => {
    expect(chromeArgs({ noSandbox: false })).not.toContain(
      "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
    );
    expect(chromeArgs({ noSandbox: false, proxyServer: "http://10.0.0.100:8888" })).toEqual(
      expect.arrayContaining([
        "--webrtc-ip-handling-policy=disable_non_proxied_udp",
        "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
      ]),
    );
  });

  it("turns off prerendering, which loads a page in a target nothing inspects", () => {
    expect(chromeArgs({ noSandbox: false })).toContain(
      "--disable-features=Prerender2,Reporting,NetworkErrorLogging",
    );
  });

  it("turns off the Reporting API and Network Error Logging, which send reports outside the request gate", () => {
    const switches = chromeArgs({ noSandbox: false }).filter((arg) =>
      arg.startsWith("--disable-features="),
    );
    expect(switches).toHaveLength(1);
    const features = switches[0]?.slice("--disable-features=".length).split(",");
    expect(features).toEqual(expect.arrayContaining(["Reporting", "NetworkErrorLogging"]));
  });

  it("adds the sandbox switch only when asked", () => {
    expect(chromeArgs({ noSandbox: true })).toContain("--no-sandbox");
    expect(chromeArgs({ noSandbox: false })).not.toContain("--no-sandbox");
  });
});

/** What Chrome itself reports for the setting, which is what it will act on. */
async function reportedPredictionOption(context: BrowserContext): Promise<unknown> {
  const page = context.pages()[0] ?? (await context.newPage());
  await page.goto("chrome://prefs-internals");
  const text = String(await page.evaluate("document.body.innerText"));
  const prefs = JSON.parse(text.slice(text.indexOf("{"))) as {
    net?: { network_prediction_options?: { value?: unknown } };
  };
  return prefs.net?.network_prediction_options?.value;
}

describe("turning preloading off in a profile", () => {
  const read = (profile: string) =>
    JSON.parse(readFileSync(join(profile, "Default", "Preferences"), "utf8"));

  it("writes the setting into a profile that has never run", () => {
    turnOffPreloading(dir);
    expect(read(dir)).toEqual({ net: { network_prediction_options: 2 } });
  });

  it("changes the setting a person turned on and keeps every other setting", () => {
    mkdirSync(join(dir, "Default"), { recursive: true });
    writeFileSync(
      join(dir, "Default", "Preferences"),
      JSON.stringify({ net: { network_prediction_options: 0, other: 1 }, homepage: "x" }),
    );
    turnOffPreloading(dir);
    expect(read(dir)).toEqual({
      net: { network_prediction_options: 2, other: 1 },
      homepage: "x",
    });
  });

  it("replaces a settings file that cannot be read", () => {
    mkdirSync(join(dir, "Default"), { recursive: true });
    writeFileSync(join(dir, "Default", "Preferences"), "{not json");
    turnOffPreloading(dir);
    expect(read(dir)).toEqual({ net: { network_prediction_options: 2 } });
  });
});

describeBrowser("the browser that makes every request of a run", () => {
  it("starts with preloading off, however the profile was left", async () => {
    mkdirSync(join(dir, "Default"), { recursive: true });
    writeFileSync(
      join(dir, "Default", "Preferences"),
      JSON.stringify({ net: { network_prediction_options: 0 } }),
    );
    const context = await launchPersistentChrome({
      profileDir: dir,
      headless: true,
      noSandbox: false,
      executablePath: null,
    });
    try {
      expect(await reportedPredictionOption(context)).toBe(2);
    } finally {
      await context.close();
    }
  });
});

describeBrowser("the browser a broker page sees", () => {
  it("does not announce itself as automated", async () => {
    const profileDir = join(dir, "profile");
    mkdirSync(profileDir, { recursive: true });
    const context = await launchPersistentChrome({
      profileDir,
      headless: true,
      noSandbox: false,
      executablePath: null,
    });
    try {
      const page = context.pages()[0] ?? (await context.newPage());
      expect(await page.evaluate("navigator.webdriver")).toBe(false);
    } finally {
      await context.close();
    }
  });
});

describeBrowser("shared workers in a browser whose requests are all inspected", () => {
  let site: Server;
  let origin: string;
  const asked: string[] = [];

  beforeAll(async () => {
    site = createServer((request, response) => {
      asked.push(request.url ?? "");
      if (request.url === "/shared.js") {
        response.writeHead(200, { "content-type": "text/javascript" });
        response.end(
          "onconnect = (e) => { fetch('/from-shared-worker', { method: 'POST', body: 'x' }); };",
        );
        return;
      }
      response.writeHead(200, { "content-type": "text/html" });
      response.end(
        "<!doctype html><title>Shared</title><script>new SharedWorker('/shared.js').port.start()</script>",
      );
    });
    await new Promise<void>((resolve) => site.listen(0, "127.0.0.1", resolve));
    origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    site.closeAllConnections();
    await new Promise<void>((resolve) => site.close(() => resolve()));
  });

  async function visit(blockSharedWorkers: boolean): Promise<void> {
    asked.length = 0;
    const profileDir = join(dir, `profile-${blockSharedWorkers}`);
    mkdirSync(profileDir, { recursive: true });
    const context = await launchPersistentChrome({
      profileDir,
      headless: true,
      noSandbox: false,
      executablePath: null,
      blockSharedWorkers,
    });
    try {
      const page = await context.newPage();
      await page.goto(origin);
      await page.waitForTimeout(1_000);
    } finally {
      await context.close();
    }
  }

  it("runs one when nothing stops it, which is what the next test rules out", async () => {
    await visit(false);
    expect(asked).toContain("/from-shared-worker");
  });

  it("never lets one run when asked, so what it would send is never sent", async () => {
    await visit(true);
    expect(asked).not.toContain("/from-shared-worker");
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
    expect(dirs).toEqual([
      join(dir, "kickrocks", "p-one", "direct"),
      join(dir, "kickrocks", "p-two", "direct"),
    ]);
  });

  it("keeps canaries and other tasks without a person in a folder of their own", async () => {
    const { dirs, launch } = fakeLauncher();
    await createProfileBrowsers(settings(), silentLogger, launch).newPage(null);
    expect(dirs).toEqual([join(dir, "kickrocks", "shared", "direct")]);
  });

  describe("a proxy the person chose for a site", () => {
    function proxiedLauncher() {
      const proxies: (string | null | undefined)[] = [];
      const launch = vi.fn(async (opened: { proxyServer?: string | null }) => {
        proxies.push(opened.proxyServer);
        const page = {};
        return {
          on: vi.fn(),
          pages: () => [page],
          newPage: async () => page,
          close: async () => undefined,
        } as never;
      });
      return { proxies, launch };
    }

    it("keeps the same browser, cookies and all, while the route does not change", async () => {
      const { launch } = proxiedLauncher();
      const browsers = createProfileBrowsers(settings(), silentLogger, launch);
      await browsers.newPage("p-one", "http://10.0.0.100:8888");
      await browsers.newPage("p-one", "http://10.0.0.100:8888");
      expect(launch).toHaveBeenCalledTimes(1);
    });

    it("restarts that profile's browser when the route changes", async () => {
      const { proxies, launch } = proxiedLauncher();
      const browsers = createProfileBrowsers(settings(), silentLogger, launch);
      await browsers.newPage("p-one", null);
      await browsers.newPage("p-one", "http://10.0.0.100:8888");
      await browsers.newPage("p-one", null);
      expect(proxies).toEqual([null, "http://10.0.0.100:8888", null]);
    });

    it("keeps each route's cookies and storage in a folder of its own", async () => {
      const { launch } = fakeLauncher();
      const browsers = createProfileBrowsers(settings(), silentLogger, launch);
      await browsers.newPage("p-one", null);
      await browsers.newPage("p-one", "http://10.0.0.100:8888");
      await browsers.newPage("p-one", "http://10.0.0.200:8888");
      await browsers.newPage("p-one", null);
      const folders = launch.mock.calls.map(([opened]) => opened.profileDir);
      expect(new Set(folders).size).toBe(3);
      expect(folders[0]).toBe(join(dir, "kickrocks", "p-one", "direct"));
      expect(folders[3]).toBe(folders[0]);
      expect(folders[1]?.startsWith(join(dir, "kickrocks", "p-one", "via-"))).toBe(true);
    });

    it("refuses a different proxy than the one the worker was started with, and says why", async () => {
      const { proxies, launch } = proxiedLauncher();
      const browsers = createProfileBrowsers(
        { ...settings(), proxyServer: "http://egress-filter:3128" },
        silentLogger,
        launch,
      );
      await expect(browsers.newPage("p-one", "http://10.0.0.100:8888")).rejects.toBeInstanceOf(
        ProxyConflictError,
      );
      await browsers.newPage("p-one", "http://egress-filter:3128");
      await browsers.newPage("p-one", null);
      expect(proxies).toEqual(["http://egress-filter:3128"]);
    });
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
      expect(closed).toEqual([join(folder("p-gone"), "direct")]);

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

describe("timezoneOption", () => {
  it("passes the host's zone to Chrome so it matches the address and the quiet hours", () => {
    expect(timezoneOption({ TZ: "America/Los_Angeles" })).toEqual({
      timezoneId: "America/Los_Angeles",
    });
  });

  it("leaves Chrome's own zone when TZ is unset, empty, or not a zone", () => {
    expect(timezoneOption({})).toEqual({});
    expect(timezoneOption({ TZ: "" })).toEqual({});
    expect(timezoneOption({ TZ: "Not/AZone" })).toEqual({});
  });
});
