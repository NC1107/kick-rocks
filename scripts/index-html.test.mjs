import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";

const html = readFileSync(join(resolve(import.meta.dirname, ".."), "apps/web/index.html"), "utf8");

describe("apps/web/index.html", () => {
  it("starts the sign-in check before the bundle runs, with a mode the app's own request can reuse", () => {
    const link = html.match(/<link[^>]*rel="preload"[^>]*href="\/api\/auth\/state"[^>]*>/)?.[0];
    assert.ok(link, "the sign-in check is not preloaded");
    assert.match(link, /as="fetch"/);
    // The app asks with credentials "same-origin", which only an anonymous preload matches;
    // use-credentials would make the browser send the request twice.
    assert.match(link, /\scrossorigin(\s|\/|>)/);
    assert.doesNotMatch(link, /use-credentials/);
  });
});
