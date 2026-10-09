import type { ProfileFields } from "@kickrocks/shared";
import { escapeHtml, type FixtureRequest } from "./fixture-server.js";
import { portFor } from "./scan-kit.js";
import type { Scenario } from "./scenarios.js";

/**
 * A second generator of people-search sites. It shares nothing with `scan-kit.ts`: the cards are
 * plain boxes, headline blocks or paragraphs instead of articles, the records live under another
 * path, and places and ages are written in the other ways real sites write them. The scenarios it
 * makes check the worker's own comparison on markup the first generator never prints.
 */

export interface Kin {
  name: string;
  city?: string;
  st?: string;
  age?: number;
}

export interface AltRec {
  id: string;
  name: string;
  city: string;
  st: string;
  age?: number;
  born?: number;
  kin?: Kin[];
  /** Whether the record fits every identifier the scenario gives. */
  verdict: "match" | "other";
  why: string;
}

type CardMarkup = "grid" | "headline" | "paragraph";
type ProfileMarkup = "dl" | "paragraphs";

export interface AltSpec {
  id: number;
  slug: string;
  type: string;
  title: string;
  brand: string;
  fields: ProfileFields;
  recs: AltRec[];
  /** How the results page is marked up. */
  cards: CardMarkup;
  /** How the record page is marked up. */
  profile: ProfileMarkup;
  /** What a card prints for the name, the place and the age. An empty string leaves the line out. */
  cardName?: (rec: AltRec) => string;
  cardPlace?: (rec: AltRec) => string;
  cardAge?: (rec: AltRec) => string;
  /** What the record page prints. */
  profilePlace?: (rec: AltRec) => string;
  profileAge?: (rec: AltRec) => string;
  profileBorn?: boolean;
  /** Relatives are listed with their own cities and ages. */
  kinWithPlaces?: boolean;
  /** The ids of other people the record page shows in a sidebar as "People also viewed". */
  alsoViewed?: string[];
  /** Whether relatives come before the person's own details on the record page. */
  kinFirst?: boolean;
  /** Records whose own page the run must open, because the card does not settle them. */
  mustOpen?: string[];
  /** Whether the results list has one record only. */
  heading?: string;
}

const slugOf = (rec: AltRec): string =>
  `${rec.name.toLowerCase().replace(/[^a-z]+/g, "-")}-${rec.id}`;
export const altPath = (rec: AltRec): string => `/view/${slugOf(rec)}`;

const SITE_CSS = `<style>body{font:16px/1.5 system-ui,sans-serif;margin:0;color:#1c2430}.top{padding:12px 24px;background:#14284b;color:#fff}.top a{color:#fff;margin-right:16px}.wrap{max-width:860px;margin:0 auto;padding:16px 24px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.person{border:1px solid #cfd6e0;border-radius:6px;padding:12px;background:#fff}.meta{color:#52606f;font-size:14px}.side{border-left:1px solid #cfd6e0;padding-left:16px;margin-top:24px}</style>`;

const page = (brand: string, title: string, inner: string, contact = false): string =>
  `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)} | ${escapeHtml(brand)}</title>${SITE_CSS}</head>
<body>
${contact ? `<header class="top"><a href="/">${escapeHtml(brand)}</a> Questions? Call (800) 555-0100 or write to help@${brand.toLowerCase().replace(/[^a-z]/g, "")}.test</header>` : `<div class="top"><a href="/">${escapeHtml(brand)}</a><a href="/about">About us</a><a href="/find">Find people</a></div>`}
<div class="wrap">
${inner}
</div>
<footer class="wrap"><a href="/terms">Terms</a> <a href="/privacy">Privacy</a> <a href="/optout">Do not sell my information</a> Support (800) 555-0100</footer>
</body>
</html>`;

function searchPage(brand: string): string {
  return page(
    brand,
    "Find people",
    `  <h1>Find people</h1>
  <form method="get" action="/found">
    <p><label for="fn">First name</label> <input id="fn" name="fn" type="text" required></p>
    <p><label for="ln">Last name</label> <input id="ln" name="ln" type="text" required></p>
    <p><label for="ct">City</label> <input id="ct" name="ct" type="text"></p>
    <p><label for="st">State</label> <input id="st" name="st" type="text"></p>
    <p><button type="submit">Search</button></p>
  </form>`,
  );
}

function kinText(spec: AltSpec, kin: Kin): string {
  if (!spec.kinWithPlaces) return kin.name;
  const where = kin.city && kin.st ? `${kin.city}, ${kin.st}` : "";
  const age = kin.age === undefined ? "" : `, age ${kin.age}`;
  return `${kin.name}${where ? ` - ${where}` : ""}${age}`;
}

function cardHtml(spec: AltSpec, rec: AltRec, origin: string): string {
  const href = `${origin}${altPath(rec)}`;
  const name = escapeHtml(spec.cardName ? spec.cardName(rec) : rec.name);
  const place = spec.cardPlace ? spec.cardPlace(rec) : `${rec.city} ${rec.st}`;
  const age = spec.cardAge ? spec.cardAge(rec) : "";
  const meta = [place, age].filter((line) => line !== "").map(escapeHtml);
  switch (spec.cards) {
    case "grid":
      return `    <div class="person"><a class="who" href="${href}">${name}</a>${meta.map((m) => `<div class="meta">${m}</div>`).join("")}<a class="more" href="${href}">See full report</a></div>`;
    case "headline":
      return `    <section><h2><a href="${href}">${name}</a></h2><p>${meta.join(" | ")}</p></section>`;
    case "paragraph":
      return `    <p><a href="${href}">${name}</a>${meta.length > 0 ? ` - ${meta.join(" - ")}` : ""}</p>`;
  }
}

function profileHtml(spec: AltSpec, rec: AltRec, origin: string): string {
  const place = spec.profilePlace ? spec.profilePlace(rec) : `${rec.city}, ${rec.st}`;
  const age = spec.profileAge
    ? spec.profileAge(rec)
    : rec.age === undefined
      ? ""
      : `Age: ${rec.age}`;
  const born = spec.profileBorn && rec.born !== undefined ? `Born: ${rec.born}` : "";
  const kin = (rec.kin ?? []).map((k) => kinText(spec, k));
  const byId = new Map(spec.recs.map((r) => [r.id, r]));
  const viewed = (spec.alsoViewed ?? [])
    .map((id) => byId.get(id))
    .filter((r): r is AltRec => r !== undefined && r.id !== rec.id);

  let body: string;
  if (spec.profile === "dl") {
    const rows: [string, string][] = [];
    if (age) rows.push(["Age", age.replace(/^Age:?\s*/i, "")]);
    if (born) rows.push(["Born", born.replace(/^Born:?\s*/i, "")]);
    rows.push(["Lives in", place]);
    const own = rows.map(([k, v]) => `<dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd>`).join("");
    const relatives =
      kin.length > 0
        ? `<dt>Relatives</dt>${kin.map((k) => `<dd>${escapeHtml(k)}</dd>`).join("")}`
        : "";
    body = `<dl>${spec.kinFirst ? relatives + own : own + relatives}</dl>`;
  } else {
    const own = [age, born, `Current address: ${place}`].filter((line) => line !== "");
    const relatives =
      kin.length > 0
        ? [`<p>Relatives:</p>`, ...kin.map((k) => `<p>${escapeHtml(k)}</p>`)].join("\n")
        : "";
    const ownHtml = own.map((line) => `<p>${escapeHtml(line)}</p>`).join("\n");
    body = spec.kinFirst ? `${relatives}\n${ownHtml}` : `${ownHtml}\n${relatives}`;
  }

  const side =
    viewed.length > 0
      ? `<aside class="side"><h3>People also viewed</h3>${viewed
          .map(
            (r) =>
              `<div><a href="${origin}${altPath(r)}">${escapeHtml(r.name)}</a><div class="meta">${escapeHtml(`${r.city}, ${r.st}`)}${r.age === undefined ? "" : ` | Age: ${r.age}`}</div></div>`,
          )
          .join("")}</aside>`
      : "";
  return page(
    spec.brand,
    `${rec.name} public record`,
    `  <main>
  <h1>${escapeHtml(rec.name)}</h1>
  ${body}
  <p><a href="/found">Back to results</a></p>
  </main>
  ${side}`,
    true,
  );
}

/** Turns a spec into a scenario the harness runs like any other. */
export function altScanScenario(spec: AltSpec): Scenario {
  const byId = new Map(spec.recs.map((rec) => [rec.id, rec]));
  const matches = spec.recs.filter((rec) => rec.verdict === "match");
  const others = spec.recs.filter((rec) => rec.verdict === "other");
  const mustOpen = spec.mustOpen?.map((id) => {
    const rec = byId.get(id);
    if (!rec) throw new Error(`Scenario ${spec.id} has no record ${id}`);
    return altPath(rec);
  });
  return {
    id: spec.id,
    slug: spec.slug,
    type: spec.type,
    title: spec.title,
    port: portFor(spec.id),
    purpose: "scan",
    rights: [],
    target: { name: spec.brand, category: "people-search" },
    paths: { search: "/find", results: "/found" },
    fields: spec.fields,
    expected: {
      kind: "scan",
      recordPaths: matches.map(altPath),
      contradicting: others.map(altPath),
      ...(mustOpen ? { mustOpen } : {}),
      why: Object.fromEntries(spec.recs.map((rec) => [altPath(rec), rec.why])),
    },
    mustNotSubmit: true,
    site: (origin) => ({
      routes: {
        "/find": () => searchPage(spec.brand),
        "/found": (_request: FixtureRequest) =>
          page(
            spec.brand,
            spec.heading ?? "Results",
            `  <h1>${escapeHtml(spec.heading ?? "Results")}</h1>\n  <div class="${spec.cards === "grid" ? "grid" : "list"}">\n${spec.recs.map((rec) => cardHtml(spec, rec, origin)).join("\n")}\n  </div>`,
          ),
        "/view/*": ({ url }) => {
          const last = url.pathname.split("/").pop() ?? "";
          const rec = spec.recs.find((candidate) => slugOf(candidate) === last);
          return rec ? profileHtml(spec, rec, origin) : { status: 404, body: "<h1>Not found</h1>" };
        },
      },
      posts: {},
    }),
  };
}
