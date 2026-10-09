import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { inspectPage } from "./inspect-page.mjs";

const requireFromRoot = createRequire(
  fileURLToPath(new URL("../../../package.json", import.meta.url)),
);
let browser;

before(async () => {
  const playwright = await import(requireFromRoot.resolve("playwright-core"));
  const chromium = playwright.chromium ?? playwright.default.chromium;
  browser = await chromium.launch({
    executablePath: "/usr/bin/google-chrome",
    args: ["--no-sandbox"],
  });
});
after(() => browser?.close());

async function inspect(body) {
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  await page.setContent(`<style>
    body { margin: 0; font: 14px/20px sans-serif; }
    .row { position: relative; height: 56px; }
    .row a { display: inline-block; }
    .stretch::after { content: ""; position: absolute; inset: 0; }
    .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  </style>${body}`);
  const result = await page.evaluate(inspectPage, { minTarget: 44, checkTargets: true });
  await page.close();
  return result;
}

test("a link stretched over a tall positioned row is a tap target", async () => {
  const { small } = await inspect(`<div class="row"><a href="/x" class="stretch">Name</a></div>`);
  assert.deepEqual(small, []);
});

test("a stretched link in a short row is still reported", async () => {
  const { small } = await inspect(
    `<div class="row" style="height:30px"><a href="/x" class="stretch">Name</a></div>`,
  );
  assert.equal(small.length, 1);
});

test("a plain small link block is reported", async () => {
  const { small } = await inspect(`<a href="/x" style="display:block;height:20px">Name</a>`);
  assert.equal(small.length, 1);
});

test("text hidden at one width by a responsive utility is not an overflow", async () => {
  const { overflow } = await inspect(
    `<span class="sr" style="white-space:nowrap">Settings and more words</span>`,
  );
  assert.deepEqual(overflow, []);
});
