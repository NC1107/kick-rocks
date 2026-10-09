import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const html = readFileSync(resolve(import.meta.dirname, "..", "index.html"), "utf8");

describe("index.html", () => {
  it("starts the sign-in check before the bundle runs, with a mode the app's own request can reuse", () => {
    const link = html.match(/<link[^>]*rel="preload"[^>]*href="\/api\/auth\/state"[^>]*>/)?.[0];
    expect(link).toBeDefined();
    expect(link).toContain('as="fetch"');
    // The app asks with credentials "same-origin", which only an anonymous preload matches;
    // use-credentials would make the browser send the request twice.
    expect(link).toMatch(/\scrossorigin(\s|\/|>)/);
    expect(link).not.toContain("use-credentials");
  });
});
