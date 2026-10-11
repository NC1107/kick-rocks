import { esc, type IndependentSpec, independentScenario, pagesUnder, shell } from "./kit.js";

const BRAND_ROWS = "RowLookup";
const BRAND_DL = "KinTrail";
const BRAND_ZIP = "ZipSeen";
const BRAND_BAND = "DecadeDir";

const simplePage = (brand: string, heading: string, lines: string[]): string =>
  shell(
    brand,
    heading,
    `<h1>${esc(heading)}</h1>\n${lines.map((l) => `<p>${esc(l)}</p>`).join("\n")}\n<p><a href="/results">Back to results</a></p>`,
  );

/** A table whose rows hold the name as a link, "Age 41" and "Lives in Austin TX". */
const table: IndependentSpec = (() => {
  const rows = [
    {
      slug: "q1",
      name: "Marisol Quenby",
      age: 41,
      where: "Austin TX",
      fits: true,
      why: "Austin TX and age 41 fit",
    },
    {
      slug: "q2",
      name: "Marisol Quenby",
      age: 41,
      where: "Dallas TX",
      fits: false,
      why: "Dallas is not Austin",
    },
    {
      slug: "q3",
      name: "Marisol Quenby",
      age: 63,
      where: "Austin TX",
      fits: false,
      why: "age 63 contradicts a 1985 birth year",
    },
    {
      slug: "q4",
      name: "Marisol R Quenby",
      age: 40,
      where: "Austin TX",
      fits: true,
      why: "a middle initial, Austin TX and age 40 fit",
    },
    {
      slug: "q5",
      name: "Marisol Quenby",
      age: 41,
      where: "Austin MN",
      fits: false,
      why: "Austin MN is another state",
    },
  ];
  return {
    id: 301,
    slug: "ind-table-rows",
    type: "independent",
    title: "A results table with Age 41 and Lives in Austin TX",
    brand: BRAND_ROWS,
    fields: {
      first_name: "Marisol",
      last_name: "Quenby",
      city: "Austin",
      state: "TX",
      birth_year: "1985",
    },
    records: rows.map((r) => ({ path: `/rec/${r.slug}`, fits: r.fits, why: r.why })),
    routes: () => ({
      "/results": shell(
        BRAND_ROWS,
        "Results",
        `<h1>5 matches for Marisol Quenby</h1>
<table>
<thead><tr><th>Person</th><th>Age</th><th>Location</th></tr></thead>
<tbody>
${rows.map((r) => `<tr><td><a href="/rec/${r.slug}">${esc(r.name)}</a></td><td>Age ${r.age}</td><td>Lives in ${esc(r.where)}</td></tr>`).join("\n")}
</tbody>
</table>`,
      ),
      ...pagesUnder(
        "/rec",
        Object.fromEntries(
          rows.map((r) => [
            r.slug,
            simplePage(BRAND_ROWS, r.name, [`Age ${r.age}`, `Lives in ${r.where}`]),
          ]),
        ),
      ),
    }),
  };
})();

/** Definition lists with the name in a link and no heading, and "Denver, Colorado" spelled out. */
const definitionList: IndependentSpec = (() => {
  const people = [
    {
      slug: "w-aa1",
      name: "Tobias Wrenfield",
      age: 47,
      where: "Denver, Colorado",
      fits: true,
      why: "Denver, Colorado and 47 fit",
    },
    {
      slug: "w-bb2",
      name: "Tobias J. Wrenfield",
      age: 46,
      where: "Denver, Colorado",
      fits: true,
      why: "a middle initial, Denver, Colorado and 46 fit",
    },
    {
      slug: "w-cc3",
      name: "Tobias Wrenfield",
      age: 47,
      where: "Aurora, Colorado",
      fits: false,
      why: "Aurora is not Denver",
    },
    {
      slug: "w-dd4",
      name: "Tobias Wrenfield",
      age: 47,
      where: "Denver, North Carolina",
      fits: false,
      why: "Denver in North Carolina is another state",
    },
    {
      slug: "w-ee5",
      name: "Tobias Wrenfeld",
      age: 47,
      where: "Denver, Colorado",
      fits: false,
      why: "Wrenfeld is another surname",
    },
  ];
  return {
    id: 302,
    slug: "ind-definition-lists",
    type: "independent",
    title: "Definition lists, the name in a link and no heading, Denver, Colorado",
    brand: BRAND_DL,
    fields: {
      first_name: "Tobias",
      last_name: "Wrenfield",
      city: "Denver",
      state: "CO",
      birth_year: "1979",
    },
    records: people.map((p) => ({ path: `/p/${p.slug}`, fits: p.fits, why: p.why })),
    routes: () => ({
      "/results": shell(
        BRAND_DL,
        "Search results",
        `<p class="muted">Showing 5 of 5 people</p>
${people
  .map(
    (p) => `<div class="card"><dl>
<dt>Name</dt><dd><a href="/p/${p.slug}">${esc(p.name)}</a></dd>
<dt>Age</dt><dd>${p.age} years old</dd>
<dt>Location</dt><dd>${esc(p.where)}</dd>
</dl></div>`,
  )
  .join("\n")}`,
      ),
      ...pagesUnder(
        "/p",
        Object.fromEntries(
          people.map((p) => [
            p.slug,
            shell(
              BRAND_DL,
              p.name,
              `<dl><dt>Full name</dt><dd>${esc(p.name)}</dd><dt>Age</dt><dd>${p.age} years old</dd><dt>Location</dt><dd>${esc(p.where)}</dd></dl>`,
            ),
          ]),
        ),
      ),
    }),
  };
})();

/** Cards that print an age and a ZIP and no city, so the profile page has to say where the person lives. */
const zipOnly: IndependentSpec = (() => {
  const people = [
    {
      slug: "o-1a",
      zip: "43215",
      city: "Columbus, OH",
      age: 36,
      fits: true,
      why: "ZIP 43215 is Columbus, which the profile states, and 36 fits",
    },
    {
      slug: "o-2b",
      zip: "43017",
      city: "Dublin, OH",
      age: 36,
      fits: false,
      why: "the profile says Dublin, not Columbus",
    },
    {
      slug: "o-3c",
      zip: "43204",
      city: "Columbus, OH",
      age: 35,
      fits: true,
      why: "the profile says Columbus, OH and 35 fits",
    },
    {
      slug: "o-4d",
      zip: "45202",
      city: "Cincinnati, OH",
      age: 36,
      fits: false,
      why: "the profile says Cincinnati",
    },
    {
      slug: "o-5e",
      zip: "43215",
      city: "Columbus, OH",
      age: 58,
      fits: false,
      why: "age 58 contradicts a 1990 birth year",
    },
  ];
  return {
    id: 303,
    slug: "ind-zip-only",
    type: "independent",
    title: "Cards with a ZIP and no city, the profile page names it",
    brand: BRAND_ZIP,
    fields: {
      first_name: "Desmond",
      last_name: "Ojala",
      city: "Columbus",
      state: "OH",
      birth_year: "1990",
    },
    records: people.map((p) => ({
      path: `/profile/${p.slug}`,
      fits: p.fits,
      why: p.why,
      open: p.fits,
    })),
    routes: () => ({
      "/results": shell(
        BRAND_ZIP,
        "Results",
        `<h1>Desmond Ojala</h1>
<ul style="list-style:none;padding:0">
${people
  .map(
    (p) =>
      `<li class="card"><a href="/profile/${p.slug}"><strong>Desmond Ojala</strong></a> <span class="muted">Age ${p.age}</span><br><span>ZIP ${p.zip}</span></li>`,
  )
  .join("\n")}
</ul>`,
      ),
      ...pagesUnder(
        "/profile",
        Object.fromEntries(
          people.map((p) => [
            p.slug,
            simplePage(BRAND_ZIP, "Desmond Ojala", [`Age ${p.age}`, `Home: ${p.city} ${p.zip}`]),
          ]),
        ),
      ),
    }),
  };
})();

/** Ages given as a decade, which can rule a record out but never pins one down. */
const ageBand: IndependentSpec = (() => {
  const people = [
    {
      slug: "h-1",
      band: "In their 40s",
      where: "Tampa, FL",
      fits: true,
      why: "a 1984 birth year is in the 40s and Tampa, FL fits",
    },
    {
      slug: "h-2",
      band: "In their 60s",
      where: "Tampa, FL",
      fits: false,
      why: "the 60s contradict a 1984 birth year",
    },
    {
      slug: "h-3",
      band: "In their 40s",
      where: "Tampa, FL",
      fits: true,
      why: "the 40s and Tampa, FL fit",
    },
    {
      slug: "h-4",
      band: "In their 40s",
      where: "St. Petersburg, FL",
      fits: false,
      why: "St. Petersburg is not Tampa",
    },
    {
      slug: "h-5",
      band: "In their 30s",
      where: "Tampa, FL",
      fits: false,
      why: "the 30s contradict a 1984 birth year",
    },
  ];
  return {
    id: 304,
    slug: "ind-age-band",
    type: "independent",
    title: "Ages shown only as In their 40s",
    brand: BRAND_BAND,
    fields: {
      first_name: "Ingrid",
      last_name: "Halvorsen",
      city: "Tampa",
      state: "FL",
      birth_year: "1984",
    },
    records: people.map((p) => ({ path: `/person/${p.slug}`, fits: p.fits, why: p.why })),
    routes: () => ({
      "/results": shell(
        BRAND_BAND,
        "People named Ingrid Halvorsen",
        `<h1>People named Ingrid Halvorsen</h1>
${people
  .map(
    (p) =>
      `<p><a href="/person/${p.slug}">Ingrid Halvorsen</a> &middot; ${p.band} &middot; ${esc(p.where)}</p>`,
  )
  .join("\n")}`,
      ),
      ...pagesUnder(
        "/person",
        Object.fromEntries(
          people.map((p) => [
            p.slug,
            simplePage(BRAND_BAND, "Ingrid Halvorsen", [p.band, `Located in ${p.where}`]),
          ]),
        ),
      ),
    }),
  };
})();

export const TABLES_AND_LISTS = [table, definitionList, zipOnly, ageBand].map(independentScenario);
