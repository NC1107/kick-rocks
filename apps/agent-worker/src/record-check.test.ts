import type { ProfileFields } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  type CardText,
  describeRecordCheck,
  judgeRecord,
  namesSomebody,
  recordCards,
} from "./record-check.js";

const YEAR = 2026;
const PERSON: ProfileFields = {
  first_name: "Jordan",
  last_name: "Example",
  city: "Austin",
  state: "TX",
  birth_year: "1990",
};

function check(
  heading: string,
  text: string,
  fields: ProfileFields = PERSON,
  onRecordPage = false,
): string {
  return describeRecordCheck({ heading, text }, fields, YEAR, onRecordPage);
}

describe("name", () => {
  it("matches the first and last name and ignores a middle initial, a middle name and a suffix", () => {
    for (const heading of [
      "Jordan Example",
      "Jordan A. Example",
      "Jordan Alex Example Jr.",
      "Example, Jordan",
    ]) {
      expect(check(heading, `${heading}\nAustin, TX`), heading).toContain("name: matches\n");
    }
  });

  it("is a different person when the first name differs", () => {
    const answer = check("Jordie Example", "Jordie Example\nAustin, TX");
    expect(answer).toContain("name: differs");
    expect(answer.endsWith("contradicts: leave it out")).toBe(true);
  });

  it("matches as an alias when only an alias line carries it", () => {
    const answer = check(
      "Jo Smith",
      "Jo Smith\nAustin, TX\nAlso known as: Jordan Example, J. Smith",
    );
    expect(answer).toContain("name: matches as an alias");
  });

  it("ignores a name that only a line of relatives or associates carries", () => {
    for (const label of ["Possible relatives", "Associates", "Related to"]) {
      const answer = check("Sam Smith", `Sam Smith\nAustin, TX\n${label}: Jordan Example`);
      expect(answer, label).toContain("name: differs");
    }
  });

  it("matches the name of a task that holds only a full name", () => {
    const answer = check("Jordan Example", "Austin, TX", {
      full_name: "Jordan Q Example",
      city: "Austin",
    });
    expect(answer).toContain("name: matches");
  });

  it("is not shown when the text has no name to read", () => {
    expect(check("", "Austin, TX\nBorn 1990")).toContain("name: not shown");
  });
});

describe("place", () => {
  it("finds the city and state in the current place or in a past one", () => {
    expect(check("Jordan Example", "Jordan Example\nTulsa, OK\nPreviously: Austin, TX")).toContain(
      "place: found in current or past places",
    );
  });

  it("finds a state written out and a code written without a comma", () => {
    expect(check("Jordan Example", "Austin, Texas")).toContain("place: found");
    expect(check("Jordan Example", "Austin TX 78701")).toContain("place: found");
  });

  it("is absent when the city is somewhere else or in another state", () => {
    expect(check("Jordan Example", "Dallas, TX")).toContain("place: absent");
    expect(check("Jordan Example", "Austin, MN")).toContain("place: absent");
  });

  it("does not count a place that only a relative has", () => {
    const answer = check(
      "Jordan Example",
      "Jordan Example\nTulsa, OK\nPossible relatives: Dana Example (Austin, TX)",
    );
    expect(answer).toContain("place: absent");
  });

  it("is not shown when the card prints no place at all", () => {
    expect(check("Jordan Example", "Jordan Example\nView free report")).toContain(
      "place: not shown",
    );
  });

  it("does not take a short word for a state code", () => {
    expect(check("Jordan Example", "Austin, in the heart of town")).toContain("place: not shown");
  });
});

describe("birth year and age", () => {
  it("compares the year after the word born, with or without a month", () => {
    expect(check("Jordan Example", "Born 1990")).toContain("birth year: matches");
    expect(check("Jordan Example", "Age 36 (born March 1990)")).toContain("birth year: matches");
    expect(check("Jordan Example", "Born 1985")).toContain("birth year: differs");
  });

  it("fits an age of the current year minus the birth year, or one less", () => {
    expect(check("Jordan Example", "Age 36")).toContain("age: fits");
    expect(check("Jordan Example", "Age 35")).toContain("age: fits");
    expect(check("Jordan Example", "Age 34")).toContain("age: does not fit");
    expect(check("Jordan Example", "Age 37")).toContain("age: does not fit");
    expect(check("Jordan Example", "61 years old")).toContain("age: does not fit");
  });

  it("says not shown when the page prints neither", () => {
    const answer = check("Jordan Example", "Austin, TX");
    expect(answer).toContain("birth year: not shown");
    expect(answer).toContain("age: not shown");
  });

  it("takes the year from a date of birth", () => {
    const answer = check("Jordan Example", "Age 36", {
      first_name: "Jordan",
      last_name: "Example",
      date_of_birth: "1990-04-05",
    });
    expect(answer).toContain("age: fits");
  });

  it("asks nothing about the age when the task has no birth year", () => {
    const answer = check("Jordan Example", "Age 61\nAustin, TX", {
      first_name: "Jordan",
      last_name: "Example",
      city: "Austin",
      state: "TX",
    });
    expect(answer).not.toContain("age:");
    expect(answer.endsWith("fits: report it")).toBe(true);
  });
});

describe("the last line", () => {
  it("fits when every identifier is decided and none contradicts", () => {
    expect(check("Jordan Example", "Age 36\nAustin, TX\nBorn 1990")).toBe(
      [
        "name: matches",
        "place: found in current or past places",
        "birth year: matches",
        "age: fits",
        "fits: report it",
      ].join("\n"),
    );
  });

  it("fits on an age alone when the birth year is not printed", () => {
    expect(check("Jordan Example", "Age 36 · Austin, TX").endsWith("fits: report it")).toBe(true);
  });

  it("is not decided on a card that leaves an identifier out, and points at the record page", () => {
    expect(
      check("Jordan Example", "Austin, TX").endsWith("not decided: open the record page"),
    ).toBe(true);
  });

  it("is decided on the record page itself when nothing it shows contradicts", () => {
    expect(check("Jordan Example", "Austin, TX", PERSON, true).endsWith("fits: report it")).toBe(
      true,
    );
    expect(
      check("", "Austin, TX", PERSON, true).endsWith("not decided: open the record page"),
    ).toBe(true);
  });

  it("leaves a record out when anything it shows contradicts, on a card or a record page", () => {
    const text = "Age 61\nAustin, TX";
    expect(check("Jordan Example", text).endsWith("contradicts: leave it out")).toBe(true);
    expect(check("Jordan Example", text, PERSON, true).endsWith("contradicts: leave it out")).toBe(
      true,
    );
  });

  it("never prints a value of the person", () => {
    const answer = check("Jordan A Example", "Age 36\nAustin, TX\nBorn 1990");
    for (const value of ["Jordan", "Example", "Austin", "TX", "1990"])
      expect(answer).not.toContain(value);
  });
});

describe("judgeRecord", () => {
  it("names what clashes without a value", () => {
    const judged = judgeRecord(
      { heading: "Jordan Example", text: "Jordan Example\nBorn 1961 Dallas, TX" },
      PERSON,
      YEAR,
      false,
    );
    expect(judged.decision).toBe("contradicts");
    expect(judged.clashes).toEqual(["place differs", "birth year differs"]);
    expect(JSON.stringify(judged)).not.toMatch(/1990|Austin/);
  });

  it("calls a record page that shows the name and contradicts nothing a fit, and its card not decided", () => {
    const record = { heading: "Jordan Example", text: "Jordan Example\nNothing else here" };
    expect(judgeRecord(record, PERSON, YEAR, true).decision).toBe("fits");
    expect(judgeRecord(record, PERSON, YEAR, false).decision).toBe("undecided");
  });
});

describe("namesSomebody", () => {
  it("is true for a heading, a line that reads as a name, or the person, and false for a footer link", () => {
    expect(namesSomebody({ heading: "Results", text: "" }, PERSON)).toBe(true);
    expect(namesSomebody({ heading: "", text: "Sam Smith\nAustin, TX" }, PERSON)).toBe(true);
    expect(namesSomebody({ heading: "", text: "jordan example" }, PERSON)).toBe(true);
    expect(namesSomebody({ heading: "", text: "Privacy policy" }, PERSON)).toBe(false);
    expect(namesSomebody({ heading: "", text: "Terms" }, PERSON)).toBe(false);
  });
});

describe("recordCards", () => {
  const card = (over: Partial<CardText>): CardText => ({
    ref: "e1",
    href: "https://a.test/p/1",
    heading: "",
    text: "",
    linkText: "",
    ...over,
  });

  it("keeps a card with a heading or a link that reads as a name, and drops the rest", () => {
    const kept = recordCards([
      card({ ref: "e1", href: "https://a.test/p/1", heading: "Jordan Example" }),
      card({ ref: "e2", href: "https://a.test/p/2", linkText: "Dana Example" }),
      card({ ref: "e3", href: "https://a.test/p/3", linkText: "Next page" }),
      card({ ref: "e4", href: "https://a.test/p/4", linkText: "Austin, TX" }),
    ]);
    expect(kept.map((c) => c.ref)).toEqual(["e1", "e2"]);
  });

  it("merges cards by address, preferring the one with a heading, and ignores a fragment", () => {
    const kept = recordCards([
      card({ ref: "e1", href: "https://a.test/p/1", linkText: "Jordan Example" }),
      card({ ref: "e2", href: "https://a.test/p/1#top", heading: "Jordan Example" }),
      card({ ref: "e3", href: "https://a.test/p/2", heading: "Sam Smith" }),
    ]);
    expect(kept.map((c) => c.ref)).toEqual(["e2", "e3"]);
  });
});
