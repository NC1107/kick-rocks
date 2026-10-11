import { esc, type IndependentSpec, independentScenario, pagesUnder, shell } from "./kit.js";

const BRAND_PAST = "AddressTrail";
const BRAND_KIN = "FamilyGraph";
const BRAND_SIDE = "NeighborBook";
const BRAND_REPORT = "ReportHub";

/** The fields hold a former address, so a record fits when that city is current or in the past list. */
const pastAddresses: IndependentSpec = (() => {
  const people = [
    {
      slug: "t1",
      age: 54,
      now: "Boise, ID",
      past: ["Spokane, WA", "Coeur d'Alene, ID"],
      kin: [] as string[],
      fits: true,
      why: "Spokane, WA is a past address and 54 fits",
    },
    {
      slug: "t2",
      age: 54,
      now: "Spokane, WA",
      past: ["Yakima, WA"],
      kin: [],
      fits: true,
      why: "Spokane, WA is the current address and 54 fits",
    },
    {
      slug: "t3",
      age: 54,
      now: "Tacoma, WA",
      past: ["Seattle, WA", "Olympia, WA"],
      kin: [],
      fits: false,
      why: "no address is Spokane",
    },
    {
      slug: "t4",
      age: 54,
      now: "Boise, ID",
      past: ["Nampa, ID"],
      kin: ["Rowan Teague, Spokane, WA"],
      fits: false,
      why: "only a relative lives in Spokane",
    },
    {
      slug: "t5",
      age: 31,
      now: "Portland, OR",
      past: ["Spokane, WA"],
      kin: [],
      fits: false,
      why: "age 31 contradicts a 1972 birth year",
    },
  ];
  return {
    id: 305,
    slug: "ind-past-addresses",
    type: "independent",
    title: "A former city searched, past address lists on the cards",
    brand: BRAND_PAST,
    fields: {
      first_name: "Cormac",
      last_name: "Teague",
      city: "Spokane",
      state: "WA",
      birth_year: "1972",
    },
    variant: true,
    records: people.map((p) => ({ path: `/who/${p.slug}`, fits: p.fits, why: p.why })),
    routes: () => ({
      "/results": shell(
        BRAND_PAST,
        "Results",
        `<h1>Cormac Teague</h1>
${people
  .map(
    (p) => `<section class="card">
<h3><a href="/who/${p.slug}">Cormac Teague</a>, ${p.age}</h3>
<p>Current address: ${esc(p.now)}</p>
<p>Past addresses:</p>
<ul>${p.past.map((a) => `<li>${esc(a)}</li>`).join("")}</ul>
${p.kin.length > 0 ? `<p>Possible relatives:</p><ul>${p.kin.map((k) => `<li>${esc(k)}</li>`).join("")}</ul>` : ""}
</section>`,
  )
  .join("\n")}`,
      ),
      ...pagesUnder(
        "/who",
        Object.fromEntries(
          people.map((p) => [
            p.slug,
            shell(
              BRAND_PAST,
              "Cormac Teague",
              `<h1>Cormac Teague, ${p.age}</h1><p>Current address: ${esc(p.now)}</p><ul>${p.past.map((a) => `<li>Past: ${esc(a)}</li>`).join("")}</ul>`,
            ),
          ]),
        ),
      ),
    }),
  };
})();

/** Cards carry a relatives section, and one card is a relative whose own card names the person. */
const relatives: IndependentSpec = (() => {
  const people = [
    {
      slug: "f1",
      name: "Lucinda Farraday",
      age: 38,
      where: "Raleigh NC",
      kin: "Hollis Farraday (Durham NC), Wren Farraday (Cary NC)",
      fits: true,
      why: "Raleigh NC and 38 fit, the relatives live elsewhere",
    },
    {
      slug: "f2",
      name: "Lucinda Farraday",
      age: 38,
      where: "Atlanta GA",
      kin: "Wren Farraday (Raleigh NC)",
      fits: false,
      why: "she lives in Atlanta, only a relative lives in Raleigh",
    },
    {
      slug: "f3",
      name: "Lucinda Farraday",
      age: 64,
      where: "Raleigh NC",
      kin: "Hollis Farraday (Raleigh NC)",
      fits: false,
      why: "age 64 contradicts a 1988 birth year",
    },
    {
      slug: "f4",
      name: "Hollis Farraday",
      age: 66,
      where: "Raleigh NC",
      kin: "Lucinda Farraday (Raleigh NC)",
      fits: false,
      why: "a relative with another first name, listed beside her",
    },
  ];
  return {
    id: 306,
    slug: "ind-relatives-section",
    type: "independent",
    title: "Relatives sections that repeat the person's city and name",
    brand: BRAND_KIN,
    fields: {
      first_name: "Lucinda",
      last_name: "Farraday",
      city: "Raleigh",
      state: "NC",
      birth_year: "1988",
    },
    records: people.map((p) => ({ path: `/f/${p.slug}`, fits: p.fits, why: p.why })),
    routes: () => ({
      "/results": shell(
        BRAND_KIN,
        "Results",
        `<h1>Farraday family records</h1>
${people
  .map(
    (p) => `<div class="card">
<p><a href="/f/${p.slug}"><b>${esc(p.name)}</b></a> (${p.age}) lives in ${esc(p.where)}</p>
<p class="muted">Relatives: ${esc(p.kin)}</p>
</div>`,
  )
  .join("\n")}`,
      ),
      ...pagesUnder(
        "/f",
        Object.fromEntries(
          people.map((p) => [
            p.slug,
            shell(
              BRAND_KIN,
              p.name,
              `<h1>${esc(p.name)}</h1><p>Age ${p.age}</p><p>Lives in ${esc(p.where)}</p><h2>Relatives</h2><p>${esc(p.kin)}</p>`,
            ),
          ]),
        ),
      ),
    }),
  };
})();

/** Results that name nobody's place, and record pages with a People also viewed sidebar full of Boise. */
const sidebar: IndependentSpec = (() => {
  const people = [
    { slug: "b1", age: 45, where: "Boise, ID", fits: true, why: "Boise, ID and 45 fit" },
    {
      slug: "b2",
      age: 45,
      where: "Reno, NV",
      fits: false,
      why: "Reno is not Boise, the sidebar's Boise belongs to other people",
    },
    {
      slug: "b3",
      age: 71,
      where: "Boise, ID",
      fits: false,
      why: "age 71 contradicts a 1981 birth year",
    },
    { slug: "b4", age: 44, where: "Boise, ID", fits: true, why: "Boise, ID and 44 fit" },
    { slug: "b5", age: 45, where: "Meridian, ID", fits: false, why: "Meridian is not Boise" },
  ];
  const sideFor = (slug: string): string => {
    const others = people.filter((p) => p.slug !== slug).slice(0, 3);
    return `<aside class="side"><h3>People also viewed</h3>${others
      .map(
        (p) =>
          `<p><a href="/rec/${p.slug}">Anselm Bright</a><br><span class="muted">${esc(p.where)} | ${p.age}</span></p>`,
      )
      .join("")}</aside>`;
  };
  return {
    id: 307,
    slug: "ind-also-viewed-sidebar",
    type: "independent",
    title: "Name-only results, record pages with a sidebar of people in the same city",
    brand: BRAND_SIDE,
    fields: {
      first_name: "Anselm",
      last_name: "Bright",
      city: "Boise",
      state: "ID",
      birth_year: "1981",
    },
    records: people.map((p) => ({
      path: `/rec/${p.slug}`,
      fits: p.fits,
      why: p.why,
      open: p.fits,
    })),
    routes: () => ({
      "/results": shell(
        BRAND_SIDE,
        "Results",
        `<h1>5 people named Anselm Bright</h1>
<ol>
${people.map((p) => `<li><a href="/rec/${p.slug}">Anselm Bright - see public record</a></li>`).join("\n")}
</ol>`,
      ),
      ...pagesUnder(
        "/rec",
        Object.fromEntries(
          people.map((p) => [
            p.slug,
            shell(
              BRAND_SIDE,
              "Anselm Bright",
              `${sideFor(p.slug)}<h1>Anselm Bright</h1><p>${p.age} years old</p><p>Lives in ${esc(p.where)}</p>`,
            ),
          ]),
        ),
      ),
    }),
  };
})();

/** The results page gives a name and a state only, and the details sit in a summary table on the record page. */
const profileRequired: IndependentSpec = (() => {
  const people = [
    { slug: "m1", age: 50, city: "Phoenix", fits: true, why: "the report says Phoenix and 50" },
    { slug: "m2", age: 50, city: "Tucson", fits: false, why: "the report says Tucson" },
    {
      slug: "m3",
      age: 29,
      city: "Phoenix",
      fits: false,
      why: "age 29 contradicts a 1976 birth year",
    },
    { slug: "m4", age: 49, city: "Phoenix", fits: true, why: "the report says Phoenix and 49" },
  ];
  return {
    id: 308,
    slug: "ind-profile-required",
    type: "independent",
    title: "A listing with a name and a state only, every detail on the report page",
    brand: BRAND_REPORT,
    fields: {
      first_name: "Yusuf",
      last_name: "Marchetti",
      city: "Phoenix",
      state: "AZ",
      birth_year: "1976",
    },
    records: people.map((p) => ({
      path: `/report/${p.slug}`,
      fits: p.fits,
      why: p.why,
      open: p.fits,
    })),
    routes: () => ({
      "/results": shell(
        BRAND_REPORT,
        "Results",
        `<h1>Yusuf Marchetti in Arizona</h1>
<table>
<tbody>
${people.map((p) => `<tr><td>Yusuf Marchetti</td><td>Arizona</td><td><a href="/report/${p.slug}">Open full report</a></td></tr>`).join("\n")}
</tbody>
</table>`,
      ),
      ...pagesUnder(
        "/report",
        Object.fromEntries(
          people.map((p) => [
            p.slug,
            shell(
              BRAND_REPORT,
              "Report",
              `<h1>Report summary</h1><table><tr><th>Name</th><td>Yusuf Marchetti</td></tr><tr><th>Age</th><td>${p.age}</td></tr><tr><th>City</th><td>${p.city}</td></tr><tr><th>State</th><td>Arizona</td></tr></table>`,
            ),
          ]),
        ),
      ),
    }),
  };
})();

export const HISTORIES = [pastAddresses, relatives, sidebar, profileRequired].map(
  independentScenario,
);
