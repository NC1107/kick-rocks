import type { ProfileFields } from "@kickrocks/shared";
import { escapeHtml, type Route } from "../fixture-server.js";
import type { Scenario } from "../scenarios.js";

/**
 * The pieces every independent scenario shares: a page shell, the search form and the step from a
 * spec to a Scenario. The result and record markup is written by hand in each scenario so the
 * layouts differ the way separate sites do, and nothing here knows how the worker compares a record.
 */

export interface ExpectedRecord {
  /** Where the record page lives. It is what a scan must report, or must not. */
  path: string;
  /** Whether the record fits every identifier the scenario gives. */
  fits: boolean;
  /** Why it is in or out, so a failure can say what the model got wrong. */
  why: string;
  /** The results page cannot settle this record, so the run has to open it. */
  open?: boolean;
}

export interface IndependentSpec {
  id: number;
  slug: string;
  type: string;
  title: string;
  brand: string;
  fields: ProfileFields;
  /** The fields hold a past address, not the current one. */
  variant?: boolean;
  /** Controls to click, in order, to reach every record. Only the scripted models read it. */
  walk?: string[];
  records: ExpectedRecord[];
  /** Everything but the search form, which the kit adds at /search. */
  routes(origin: string): { [path: string]: Route };
}

export const esc = escapeHtml;

const CSS = `<style>
body{font:16px/1.5 system-ui,sans-serif;margin:0;color:#1d2733;background:#fafafa}
.bar{background:#26364a;color:#fff;padding:12px 24px}
.bar a{color:#fff;text-decoration:none;font-weight:600}
.wrap{max-width:880px;margin:0 auto;padding:16px 24px}
.muted{color:#5d6b7a;font-size:14px}
table{border-collapse:collapse;width:100%}
th,td{border-bottom:1px solid #d9dee5;padding:8px;text-align:left}
.card{background:#fff;border:1px solid #d9dee5;border-radius:6px;padding:12px;margin:10px 0}
.side{float:right;width:240px;border-left:1px solid #d9dee5;padding-left:16px;margin-left:16px}
footer{max-width:880px;margin:0 auto;padding:16px 24px;color:#5d6b7a;font-size:13px}
</style>`;

export function shell(brand: string, title: string, inner: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)} - ${esc(brand)}</title>${CSS}</head>
<body>
<div class="bar"><a href="/">${esc(brand)}</a></div>
<div class="wrap">
${inner}
</div>
<footer>Terms of use | Privacy | Questions: help@${esc(brand.toLowerCase().replace(/[^a-z]/g, ""))}.test</footer>
</body>
</html>`;
}

function searchPage(brand: string): string {
  return shell(
    brand,
    "Find a person",
    `<h1>Find a person</h1>
<form method="get" action="/results">
  <p><label for="a">First name</label><br><input id="a" name="a" type="text"></p>
  <p><label for="b">Last name</label><br><input id="b" name="b" type="text"></p>
  <p><label for="c">City</label><br><input id="c" name="c" type="text"></p>
  <p><label for="d">State</label><br><input id="d" name="d" type="text"></p>
  <p><button type="submit">Search</button></p>
</form>`,
  );
}

/** Answers every path under a prefix from a table of pages keyed by the last path segment. */
export function pagesUnder(
  prefix: string,
  pages: { [slug: string]: string },
): { [path: string]: Route } {
  return {
    [`${prefix}/*`]: ({ url }) => {
      const slug = url.pathname.split("/").pop() ?? "";
      const body = pages[slug];
      return body === undefined
        ? { status: 404, body: "<!doctype html><title>Not found</title><h1>Not found</h1>" }
        : body;
    },
  };
}

/** The fixture server reads a plain string route as a file name, and every page here is markup. */
const literal = (route: Route): Route => (typeof route === "string" ? () => route : route);

export function independentScenario(spec: IndependentSpec): Scenario {
  const opened = spec.records.filter((r) => r.open).map((r) => r.path);
  return {
    id: spec.id,
    slug: spec.slug,
    type: spec.type,
    title: spec.title,
    purpose: "scan",
    rights: [],
    target: { name: spec.brand, category: "people-search" },
    paths: { search: "/search", results: "/results" },
    fields: spec.fields,
    ...(spec.variant ? { variant: true } : {}),
    ...(spec.walk ? { walk: spec.walk } : {}),
    expected: {
      kind: "scan",
      recordPaths: spec.records.filter((r) => r.fits).map((r) => r.path),
      contradicting: spec.records.filter((r) => !r.fits).map((r) => r.path),
      ...(opened.length > 0 ? { mustOpen: opened } : {}),
      why: Object.fromEntries(spec.records.map((r) => [r.path, r.why])),
    },
    mustNotSubmit: true,
    site: (origin) => ({
      routes: Object.fromEntries(
        Object.entries({ "/search": searchPage(spec.brand), ...spec.routes(origin) }).map(
          ([path, route]) => [path, literal(route)],
        ),
      ),
      posts: {},
    }),
  };
}
