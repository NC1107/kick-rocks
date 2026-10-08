import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LoadingScreen } from "./AuthGate.js";

const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");

describe("the loading shell in index.html", () => {
  it("is the markup of the loading screen, so the first paint does not wait for the scripts and React swaps it in place", () => {
    const shell = /<div id="root">([\s\S]*?)<\/div>\s*<script type="module"/.exec(html)?.[1];
    expect(shell?.replace(/\s+/g, " ").trim()).toBe(
      renderToStaticMarkup(<LoadingScreen />)
        .replace(/\s+/g, " ")
        .trim(),
    );
  });
});
