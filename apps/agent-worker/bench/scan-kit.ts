import type { ProfileFields } from "@kickrocks/shared";
import { escapeHtml, type FixtureRequest, type Route } from "./fixture-server.js";
import type { Scenario } from "./scenarios.js";

/** One person a fixture people-search site lists. Every name and place is invented. */
export interface Rec {
  id: string;
  name: string;
  aka?: string[];
  age?: number;
  born?: number;
  city: string;
  st: string;
  /** Earlier places in the form the site prints them, such as "Tulsa, OK". */
  past?: string[];
  kin?: string[];
  /** Whether the record fits every identifier the scenario gives. */
  verdict: "match" | "other";
  /** Why, in the words a failure message repeats. */
  why: string;
  /** Extra HTML on the record's own page. */
  detail?: string;
}

/** What a result card prints. A card shows only what its flag asks for, so a scenario can hide the deciding fact on the record page. */
export interface Show {
  age?: boolean;
  born?: boolean;
  aka?: boolean;
  past?: boolean;
  kin?: boolean;
  location?: (rec: Rec) => string;
  title?: (rec: Rec) => string;
}

export interface ListingContext {
  origin: string;
  card(rec: Rec): string;
  byId(id: string): Rec;
}

export type Listing =
  | { kind: "single"; ids: string[] }
  | { kind: "paged"; pages: string[][] }
  | { kind: "more"; initial: string[]; extra: string[]; label?: string }
  | { kind: "html"; html: (context: ListingContext) => string };

export interface ScanSpec {
  id: number;
  slug: string;
  type: string;
  title: string;
  brand: string;
  port?: number;
  fields: ProfileFields;
  variant?: boolean;
  recs: Rec[];
  listing: Listing;
  show?: Show;
  heading?: string;
  /** HTML under the results heading. */
  intro?: string;
  /** Records whose own page the run must open, as ids. */
  mustOpen?: string[];
  /** Text a page uses to push a run toward an opt-out, and the form paths that would take it. */
  bait?: { results?: string; profile?: string; posts: string[] };
}

/** Scenarios run one at a time, so they share the ten fixture ports. */
export const portFor = (id: number): number => 8650 + (id % 10);

type Bits = Partial<Pick<Rec, "aka" | "past" | "kin" | "detail">>;

/** A record that fits every identifier the scenario gives. */
export const fits = (
  id: string,
  name: string,
  place: [city: string, st: string],
  age: number | undefined,
  born: number | undefined,
  why: string,
  bits: Bits = {},
): Rec => ({
  id,
  name,
  city: place[0],
  st: place[1],
  ...(age === undefined ? {} : { age }),
  ...(born === undefined ? {} : { born }),
  verdict: "match",
  why,
  ...bits,
});

/** A record that contradicts an identifier the scenario gives. */
export const clashes = (
  id: string,
  name: string,
  place: [city: string, st: string],
  age: number | undefined,
  born: number | undefined,
  why: string,
  bits: Bits = {},
): Rec => ({ ...fits(id, name, place, age, born, why, bits), verdict: "other" });

export const recordPath = (rec: Pick<Rec, "id">): string => `/profile/${rec.id}`;

const page = (brand: string, title: string, inner: string): string =>
  `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>${escapeHtml(title)} - ${escapeHtml(brand)}</title><link rel="stylesheet" href="/site.css"></head>
<body>
<header class="site"><a class="brand" href="/">${escapeHtml(brand)}</a><nav><a href="/search">People search</a><a href="/phone">Reverse phone</a><a href="/address">Address lookup</a></nav></header>
<main>
${inner}
</main>
<footer class="site"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/optout">Do not sell my information</a></footer>
</body>
</html>`;

function homePage(brand: string): string {
  return page(
    brand,
    "Find a person",
    `  <h1>People search</h1>
  <p class="lede">Search public records by name and location.</p>
  <form method="get" action="/results">
    <label for="first">First name</label>
    <input id="first" name="first" type="text" required>
    <label for="last">Last name</label>
    <input id="last" name="last" type="text" required>
    <label for="city">City</label>
    <input id="city" name="city" type="text">
    <label for="state">State</label>
    <input id="state" name="state" type="text">
    <button class="primary" type="submit">Search</button>
  </form>`,
  );
}

function ageLine(rec: Rec, show: Pick<Show, "age" | "born">): string | null {
  const age = show.age && rec.age !== undefined ? `Age ${rec.age}` : null;
  const born = show.born && rec.born !== undefined ? `born ${rec.born}` : null;
  if (age && born) return `${age} (${born})`;
  if (age) return age;
  return born ? `${born.charAt(0).toUpperCase()}${born.slice(1)}` : null;
}

function cardHtml(origin: string, rec: Rec, show: Show): string {
  const href = `${origin}${recordPath(rec)}`;
  const place = escapeHtml(show.location ? show.location(rec) : `${rec.city}, ${rec.st}`);
  const age = ageLine(rec, show);
  const first = [age ? escapeHtml(age) : null, place].filter(Boolean).join(" &middot; ");
  const muted = [
    show.aka && rec.aka?.length ? `Also known as: ${rec.aka.join(", ")}.` : null,
    show.past && rec.past?.length ? `Also lived in: ${rec.past.join("; ")}.` : null,
    show.kin && rec.kin?.length ? `Possible relatives: ${rec.kin.join(", ")}.` : null,
  ].filter((line): line is string => line !== null);
  return `  <article class="card">
    <h3><a href="${href}">${escapeHtml(show.title ? show.title(rec) : rec.name)}</a></h3>
    <p>${first}</p>
${muted.length > 0 ? `    <p class="muted">${escapeHtml(muted.join(" "))}</p>\n` : ""}    <a href="${href}">View free report</a>
  </article>`;
}

function profilePage(brand: string, rec: Rec, bait: string | undefined): string {
  const age = ageLine(rec, { age: true, born: true }) ?? "Age not listed";
  const lines = [
    rec.aka?.length ? `Also known as: ${rec.aka.join(", ")}.` : null,
    `${age}.`,
    `Current address: ${rec.city}, ${rec.st}.`,
    rec.past?.length ? `Previous: ${rec.past.join("; ")}.` : "Previous: none listed.",
    `Relatives: ${rec.kin?.length ? rec.kin.join(", ") : "none listed"}.`,
  ].filter((line): line is string => line !== null);
  return page(
    brand,
    `${rec.name} - public record`,
    `  <h1>${escapeHtml(rec.name)}</h1>
  <p class="muted">Public record summary</p>
${lines.map((line) => `  <p>${escapeHtml(line)}</p>`).join("\n")}
${rec.detail ?? ""}${bait ?? ""}
  <p><a href="/results">Back to results</a></p>`,
  );
}

function pager(origin: string, current: number, total: number): string {
  const numbers = Array.from({ length: total }, (_, i) => i + 1)
    .map((n) =>
      n === current
        ? `<strong>${n}</strong>`
        : `<a href="${origin}${n === 1 ? "/results" : `/results/${n}`}">${n}</a>`,
    )
    .join(" ");
  const next = current < total ? ` <a href="${origin}/results/${current + 1}">Next page</a>` : "";
  return `  <nav class="pager"><p class="muted">Page ${current} of ${total}: ${numbers}${next}</p></nav>`;
}

/** Turns a spec into a scenario the harness runs like any other. */
export function scanScenario(spec: ScanSpec): Scenario {
  const recById = new Map(spec.recs.map((rec) => [rec.id, rec]));
  const byId = (id: string): Rec => {
    const rec = recById.get(id);
    if (!rec) throw new Error(`Scenario ${spec.id} has no record ${id}`);
    return rec;
  };
  const show = spec.show ?? { age: true, born: true, aka: true, past: true, kin: true };
  const matches = spec.recs.filter((rec) => rec.verdict === "match");
  const others = spec.recs.filter((rec) => rec.verdict === "other");

  const resultsPage = (origin: string, request: FixtureRequest): string => {
    const context: ListingContext = {
      origin,
      card: (rec) => cardHtml(origin, rec, show),
      byId,
    };
    const listing = spec.listing;
    const heading = spec.heading ?? "Search results";
    const top = `  <h1>${escapeHtml(heading)}</h1>\n${spec.intro ?? ""}${spec.bait?.results ?? ""}`;
    switch (listing.kind) {
      case "single":
        return page(
          spec.brand,
          heading,
          `${top}\n${listing.ids.map((id) => context.card(byId(id))).join("\n")}`,
        );
      case "paged": {
        const segment = Number(request.url.pathname.split("/").pop());
        const number = Number.isInteger(segment) && segment >= 1 ? segment : 1;
        const ids = listing.pages[number - 1] ?? [];
        return page(
          spec.brand,
          `${heading}, page ${number}`,
          `${top}\n${ids.map((id) => context.card(byId(id))).join("\n")}\n${pager(origin, number, listing.pages.length)}`,
        );
      }
      case "more":
        return page(
          spec.brand,
          heading,
          `${top}
  <div id="cards">
${listing.initial.map((id) => context.card(byId(id))).join("\n")}
  </div>
  <template id="rest">
${listing.extra.map((id) => context.card(byId(id))).join("\n")}
  </template>
  <p><button type="button" class="primary" id="more">${escapeHtml(listing.label ?? `View ${listing.extra.length} more results`)}</button></p>
  <script>
    document.getElementById("more").addEventListener("click", function () {
      document.getElementById("cards").appendChild(document.getElementById("rest").content.cloneNode(true));
      this.remove();
    });
  </script>`,
        );
      case "html":
        return page(spec.brand, heading, `${top}\n${listing.html(context)}`);
    }
  };

  const walk =
    spec.listing.kind === "paged"
      ? spec.listing.pages.slice(1).map(() => "Next page")
      : spec.listing.kind === "more"
        ? [spec.listing.label ?? `View ${spec.listing.extra.length} more results`]
        : [];

  const received =
    (message: string): Route =>
    () =>
      page(
        spec.brand,
        "Request received",
        `  <h1>Request received</h1>\n  <div class="ok">${message}</div>`,
      );

  return {
    id: spec.id,
    slug: spec.slug,
    type: spec.type,
    title: spec.title,
    port: spec.port ?? portFor(spec.id),
    purpose: "scan",
    rights: [],
    target: { name: spec.brand, category: "people-search" },
    paths: { search: "/search" },
    fields: spec.fields,
    ...(spec.variant ? { variant: true } : {}),
    ...(walk.length > 0 ? { walk } : {}),
    expected: {
      kind: "scan",
      recordPaths: matches.map(recordPath),
      contradicting: others.map(recordPath),
      ...(spec.mustOpen ? { mustOpen: spec.mustOpen.map((id) => recordPath(byId(id))) } : {}),
      why: Object.fromEntries(spec.recs.map((rec) => [recordPath(rec), rec.why])),
    },
    mustNotSubmit: true,
    site: (origin) => ({
      routes: {
        "/search": () => homePage(spec.brand),
        "/results": (request) => resultsPage(origin, request),
        "/results/*": (request) => resultsPage(origin, request),
        "/profile/*": ({ url }) => {
          const rec = recById.get(url.pathname.split("/").pop() ?? "");
          return rec
            ? profilePage(spec.brand, rec, spec.bait?.profile)
            : { status: 404, body: "<h1>Not found</h1>" };
        },
      },
      posts: Object.fromEntries(
        (spec.bait?.posts ?? []).map((path) => [path, received("Your request was received.")]),
      ),
    }),
  };
}
