import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function section(markdown, heading) {
  const start = markdown.indexOf(`## ${heading}\n`);
  assert.notEqual(start, -1, `README has no "${heading}" section`);
  const next = markdown.indexOf("\n## ", start + 1);
  return markdown.slice(start, next === -1 ? undefined : next);
}

describe("the README data flow", () => {
  const readme = read("README.md");
  const table = section(readme, "Where your data goes");

  it("has a row for every place data leaves the machine", () => {
    for (const who of [
      "Your mail provider",
      "Brokers and companies, by email",
      "Broker sites, in the browser",
      "Company sites, for confirmation links",
      "The agent worker's model",
      "An mcp client and its model",
      "The reply classifier endpoint",
      "ntfy or telegram",
    ]) {
      assert.ok(table.includes(`| ${who} |`), `missing row: ${who}`);
    }
  });

  it("gives every row three cells", () => {
    const rows = table.split("\n").filter((line) => line.startsWith("|"));
    assert.ok(rows.length > 2);
    for (const row of rows) assert.equal(row.split("|").length, 5, row);
  });

  it("scopes the placeholder claim to the agent worker", () => {
    assert.ok(!readme.includes("The model only sees your profile values as placeholders."));
    assert.match(readme, /agent worker masks your profile values/);
    assert.match(readme, /mcp client doesn't get that/);
  });

  it("names the fields typed into broker sites and sent to an mcp client", () => {
    const row = (who) => table.split("\n").find((line) => line.startsWith(`| ${who} |`));
    for (const who of ["Broker sites, in the browser", "An mcp client and its model"]) {
      assert.match(row(who), /street address, zip or birth year/, who);
    }
    assert.match(row("Broker sites, in the browser"), /form provider/);
    assert.match(row("Brokers and companies, by email"), /asking for more to verify you/);
    assert.match(readme, /street address, zip or birth year/);
  });

  it("states the limits of a request", () => {
    const limits = section(readme, "Limits");
    for (const phrase of [
      /not legal advice/,
      /may not apply to a given business/,
      /doesn't guarantee/,
      /add you back/,
      /new link between your name and your email/,
      /Many states have no privacy law/,
    ]) {
      assert.match(limits, phrase);
    }
  });
});

describe("the notices", () => {
  it("names every dataset source with its license in the root NOTICE", () => {
    const notice = read("NOTICE");
    assert.match(notice, /Big Ass Data Broker Opt-Out List/);
    assert.match(notice, /Attribution-NonCommercial-ShareAlike/);
    assert.match(notice, /Eraser/);
    assert.match(notice, /License: MIT/);
    assert.match(notice, /California Data Broker Registry/);
  });
});

describe("polite scanning wording", () => {
  const scanning = read("docs/scanning.md");

  it("does not call the automation flag hidden, which reads as evasion", () => {
    assert.ok(!scanning.includes("automation flag hidden"));
    assert.match(scanning, /not an attempt to pass a bot check/);
  });

  it("has no doubled verb in the reputation bullet", () => {
    assert.ok(!scanning.includes("ranges are scored as riskier"));
  });
});
