import { esc, type IndependentSpec, independentScenario, pagesUnder, shell } from "./kit.js";

const BRAND_PAGES = "PageThrough";
const BRAND_MORE = "MoreResults";
const BRAND_NONE = "NoneFound";
const BRAND_CITY = "CityMatch";

const detail = (brand: string, name: string, age: number, where: string): string =>
  shell(
    brand,
    name,
    `<h1>${esc(name)}</h1><p>Age ${age}</p><p>${esc(where)}</p><p><a href="/results">Back to results</a></p>`,
  );

/** Three result pages reached by numbered links and Next, with a match on the first and the last. */
const pagination: IndependentSpec = (() => {
  const pages: { slug: string; age: number; where: string; fits: boolean; why: string }[][] = [
    [
      { slug: "pa1", age: 33, where: "Madison, WI", fits: true, why: "Madison, WI and 33 fit" },
      {
        slug: "pa2",
        age: 33,
        where: "Milwaukee, WI",
        fits: false,
        why: "Milwaukee is not Madison",
      },
    ],
    [
      {
        slug: "pb1",
        age: 57,
        where: "Madison, WI",
        fits: false,
        why: "age 57 contradicts a 1993 birth year",
      },
      {
        slug: "pb2",
        age: 33,
        where: "Madison, AL",
        fits: false,
        why: "Madison, AL is another state",
      },
    ],
    [
      { slug: "pc1", age: 32, where: "Madison, WI", fits: true, why: "Madison, WI and 32 fit" },
      {
        slug: "pc2",
        age: 33,
        where: "Green Bay, WI",
        fits: false,
        why: "Green Bay is not Madison",
      },
    ],
  ];
  const everyone = pages.flat();
  const nav = (n: number): string =>
    `<nav>Page ${n} of 3: ${[1, 2, 3].map((i) => (i === n ? `<b>${i}</b>` : `<a href="/results?page=${i}">${i}</a>`)).join(" ")}${n > 1 ? ` <a href="/results?page=${n - 1}">&laquo; Previous</a>` : ""}${n < 3 ? ` <a href="/results?page=${n + 1}">Next &raquo;</a>` : ""}</nav>`;
  return {
    id: 309,
    slug: "ind-numbered-pagination",
    type: "independent",
    title: "Three result pages with numbered links and Next",
    brand: BRAND_PAGES,
    fields: {
      first_name: "Odette",
      last_name: "Prewitt",
      city: "Madison",
      state: "WI",
      birth_year: "1993",
    },
    walk: ["Next", "Next"],
    records: everyone.map((p) => ({ path: `/person/${p.slug}`, fits: p.fits, why: p.why })),
    routes: () => ({
      "/results": ({ url }) => {
        const n = Math.min(3, Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1));
        const rows = pages[n - 1] ?? [];
        return shell(
          BRAND_PAGES,
          "Results",
          `<h1>6 people named Odette Prewitt</h1>
${rows.map((p) => `<div class="card"><a href="/person/${p.slug}">Odette Prewitt</a><br>${p.age} yrs | ${esc(p.where)}</div>`).join("\n")}
${nav(n)}`,
        );
      },
      ...pagesUnder(
        "/person",
        Object.fromEntries(
          everyone.map((p) => [p.slug, detail(BRAND_PAGES, "Odette Prewitt", p.age, p.where)]),
        ),
      ),
    }),
  };
})();

/** More people sit behind a button that reveals them on the same page. */
const showMore: IndependentSpec = (() => {
  const first = [
    { slug: "r1", age: 57, where: "Albany, NY", fits: true, why: "Albany, NY and 57 fit" },
    { slug: "r2", age: 57, where: "Troy, NY", fits: false, why: "Troy is not Albany" },
    {
      slug: "r3",
      age: 31,
      where: "Albany, NY",
      fits: false,
      why: "age 31 contradicts a 1969 birth year",
    },
    {
      slug: "r4",
      age: 56,
      where: "Schenectady, NY",
      fits: false,
      why: "Schenectady is not Albany",
    },
  ];
  const hidden = [
    {
      slug: "r5",
      age: 56,
      where: "Albany, NY",
      fits: true,
      why: "Albany, NY and 56 fit, found behind the button",
    },
    { slug: "r6", age: 57, where: "Albany, GA", fits: false, why: "Albany, GA is another state" },
    {
      slug: "r7",
      age: 57,
      where: "Albany, NY",
      fits: true,
      why: "Albany, NY and 57 fit, found behind the button",
    },
    {
      slug: "r8",
      age: 80,
      where: "Albany, NY",
      fits: false,
      why: "age 80 contradicts a 1969 birth year",
    },
  ];
  const row = (p: (typeof first)[number], hide: boolean): string =>
    `<div class="card"${hide ? " hidden data-extra" : ""}><a href="/u/${p.slug}"><b>Rhys Lindqvist</b></a> <span class="muted">${p.age} | ${esc(p.where)}</span></div>`;
  return {
    id: 310,
    slug: "ind-show-more-button",
    type: "independent",
    title: "Four people, then a button that shows four more in place",
    brand: BRAND_MORE,
    fields: {
      first_name: "Rhys",
      last_name: "Lindqvist",
      city: "Albany",
      state: "NY",
      birth_year: "1969",
    },
    walk: ["Show 4 more"],
    records: [...first, ...hidden].map((p) => ({ path: `/u/${p.slug}`, fits: p.fits, why: p.why })),
    routes: () => ({
      "/results": shell(
        BRAND_MORE,
        "Results",
        `<h1>Rhys Lindqvist</h1>
${first.map((p) => row(p, false)).join("\n")}
${hidden.map((p) => row(p, true)).join("\n")}
<p><button id="more" type="button">Show 4 more people</button></p>
<script>
document.getElementById("more").addEventListener("click", function () {
  document.querySelectorAll("[data-extra]").forEach(function (el) { el.hidden = false; });
  this.remove();
});
</script>`,
      ),
      ...pagesUnder(
        "/u",
        Object.fromEntries(
          [...first, ...hidden].map((p) => [
            p.slug,
            detail(BRAND_MORE, "Rhys Lindqvist", p.age, p.where),
          ]),
        ),
      ),
    }),
  };
})();

/** Nobody fits: the page says so and offers similar names and other states, none of which is the person. */
const noResults: IndependentSpec = (() => {
  const similar = [
    {
      slug: "n1",
      name: "Caliope Strand",
      age: 31,
      where: "Omaha, NE",
      why: "Caliope is another first name",
    },
    {
      slug: "n2",
      name: "Calliope Strand",
      age: 30,
      where: "Tulsa, OK",
      why: "Tulsa, OK is not Omaha",
    },
    {
      slug: "n3",
      name: "Calliope Strand",
      age: 31,
      where: "Lincoln, NE",
      why: "Lincoln is not Omaha",
    },
  ];
  return {
    id: 311,
    slug: "ind-nothing-found",
    type: "independent",
    title: "No records, with similar names and other states offered",
    brand: BRAND_NONE,
    fields: {
      first_name: "Calliope",
      last_name: "Strand",
      city: "Omaha",
      state: "NE",
      birth_year: "1995",
    },
    records: similar.map((p) => ({ path: `/rec/${p.slug}`, fits: false, why: p.why })),
    routes: () => ({
      "/results": shell(
        BRAND_NONE,
        "No records found",
        `<h1>We could not find Calliope Strand in Omaha, NE</h1>
<p>Check the spelling or try fewer details.</p>
<h2>Similar names</h2>
<ul>${similar.map((p) => `<li><a href="/rec/${p.slug}">${esc(p.name)}</a>, ${p.age}, ${esc(p.where)}</li>`).join("")}</ul>
<h2>Browse by state</h2>
<p>Alabama | Alaska | Arizona | Nebraska | Oklahoma</p>`,
      ),
      ...pagesUnder(
        "/rec",
        Object.fromEntries(
          similar.map((p) => [p.slug, detail(BRAND_NONE, p.name, p.age, p.where)]),
        ),
      ),
    }),
  };
})();

/** Results grouped under city headings: the name and the city agree on several records and the age does not. */
const ageContradicts: IndependentSpec = (() => {
  const charlotte = [
    { slug: "c1", age: 41, fits: true, why: "Charlotte, NC and 41 fit" },
    {
      slug: "c2",
      age: 58,
      fits: false,
      why: "Charlotte, NC matches but age 58 contradicts a 1985 birth year",
    },
    {
      slug: "c3",
      age: 24,
      fits: false,
      why: "Charlotte, NC matches but age 24 contradicts a 1985 birth year",
    },
  ];
  const concord = [{ slug: "c4", age: 41, fits: false, why: "Concord is not Charlotte" }];
  return {
    id: 312,
    slug: "ind-age-contradicts",
    type: "independent",
    title: "Results grouped by city, where the right name and city carry the wrong age",
    brand: BRAND_CITY,
    fields: {
      first_name: "Beatrix",
      last_name: "Lowell",
      city: "Charlotte",
      state: "NC",
      birth_year: "1985",
    },
    records: [...charlotte, ...concord].map((p) => ({
      path: `/b/${p.slug}`,
      fits: p.fits,
      why: p.why,
    })),
    routes: () => ({
      "/results": shell(
        BRAND_CITY,
        "Results",
        `<h1>Beatrix Lowell</h1>
<h2>Charlotte, NC (3)</h2>
${charlotte.map((p) => `<p><a href="/b/${p.slug}">Beatrix Lowell</a> <small>Age ${p.age}</small></p>`).join("\n")}
<h2>Concord, NC (1)</h2>
${concord.map((p) => `<p><a href="/b/${p.slug}">Beatrix Lowell</a> <small>Age ${p.age}</small></p>`).join("\n")}`,
      ),
      ...pagesUnder(
        "/b",
        Object.fromEntries(
          [
            ...charlotte.map((p) => ({ ...p, where: "Charlotte, NC" })),
            ...concord.map((p) => ({ ...p, where: "Concord, NC" })),
          ].map((p) => [p.slug, detail(BRAND_CITY, "Beatrix Lowell", p.age, p.where)]),
        ),
      ),
    }),
  };
})();

export const PAGING = [pagination, showMore, noResults, ageContradicts].map(independentScenario);
