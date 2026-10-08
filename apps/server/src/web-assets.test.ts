import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, type TestContext } from "./test-utils/index.js";

const SCRIPT = "console.log('kick rocks');".repeat(40);
let dist: string;
let ctx: TestContext;

beforeEach(async () => {
  dist = mkdtempSync(join(tmpdir(), "kickrocks-dist-"));
  mkdirSync(join(dist, "assets"));
  writeFileSync(join(dist, "index.html"), "<!doctype html><title>Kick Rocks</title>");
  writeFileSync(join(dist, "theme-init.js"), "// theme");
  writeFileSync(join(dist, "assets", "app-abc123.js"), SCRIPT);
  writeFileSync(join(dist, "assets", "app-abc123.js.br"), brotliCompressSync(SCRIPT));
  writeFileSync(join(dist, "assets", "app-abc123.js.gz"), gzipSync(SCRIPT));
  ctx = await createTestContext({ env: { KICKROCKS_WEB_DIST: dist } });
});

afterEach(async () => {
  await ctx.close();
  rmSync(dist, { recursive: true, force: true });
});

const get = (url: string, encoding?: string) =>
  ctx.app.inject({ url, headers: encoding ? { "accept-encoding": encoding } : {} });

describe("compressed web assets", () => {
  it("serves the brotli file to a client that accepts it", async () => {
    const response = await get("/assets/app-abc123.js", "gzip, br");
    expect(response.headers["content-encoding"]).toBe("br");
    expect(response.headers["content-type"]).toContain("javascript");
    expect(response.headers.vary).toContain("accept-encoding");
    expect(response.rawPayload.equals(brotliCompressSync(SCRIPT))).toBe(true);
  });

  it("falls back to gzip, then to the plain file", async () => {
    expect((await get("/assets/app-abc123.js", "gzip")).headers["content-encoding"]).toBe("gzip");
    const plain = await get("/assets/app-abc123.js");
    expect(plain.headers["content-encoding"]).toBeUndefined();
    expect(plain.body).toBe(SCRIPT);
  });
});

describe("web asset caching", () => {
  it("lets a browser keep a hashed asset for a year without asking again", async () => {
    const response = await get("/assets/app-abc123.js", "br");
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
  });

  it("makes a browser revalidate the entry page and the theme script", async () => {
    for (const url of ["/", "/index.html", "/theme-init.js", "/requests"]) {
      expect((await get(url)).headers["cache-control"], url).toBe("no-cache");
    }
  });

  it("never marks a missing asset, which falls back to the entry page, as immutable", async () => {
    const response = await get("/assets/gone-def456.js");
    expect(response.headers["cache-control"]).toBe("no-cache");
  });
});
