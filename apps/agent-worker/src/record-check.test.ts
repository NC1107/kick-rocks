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

  it("fits an age of the current year minus the birth year, or one less, and leaves up to five years off unclear", () => {
    expect(check("Jordan Example", "Age 36")).toContain("age: fits");
    expect(check("Jordan Example", "Age 35")).toContain("age: fits");
    expect(check("Jordan Example", "Age 33")).toContain("age: not clear");
    expect(check("Jordan Example", "Age 38")).toContain("age: not clear");
    expect(check("Jordan Example", "Age 32")).toContain("age: not clear");
    expect(check("Jordan Example", "Age 30")).toContain("age: not clear");
    expect(check("Jordan Example", "Age 41")).toContain("age: not clear");
    expect(check("Jordan Example", "Age 29")).toContain("age: does not fit");
    expect(check("Jordan Example", "Age 42")).toContain("age: does not fit");
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
    expect(answer.endsWith("fits: include it in your report")).toBe(true);
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
        "fits: include it in your report",
      ].join("\n"),
    );
  });

  it("fits on an age alone when the birth year is not printed", () => {
    expect(
      check("Jordan Example", "Age 36 · Austin, TX").endsWith("fits: include it in your report"),
    ).toBe(true);
  });

  it("is not decided on a card that leaves an identifier out, and points at the record page", () => {
    expect(
      check("Jordan Example", "Austin, TX").endsWith(
        "not decided: call check_record without a ref on the results page",
      ),
    ).toBe(true);
  });

  it("is decided on the record page itself when nothing it shows contradicts", () => {
    expect(
      check("Jordan Example", "Austin, TX", PERSON, true).endsWith(
        "fits: include it in your report",
      ),
    ).toBe(true);
    expect(
      check("", "Austin, TX", PERSON, true).endsWith(
        "not decided: call check_record without a ref on the results page",
      ),
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

  it("calls a record page a fit when it shows the name and one identifier that matches, and its card not decided", () => {
    const record = { heading: "Jordan Example", text: "Jordan Example\nLives in Austin, TX" };
    expect(judgeRecord(record, PERSON, YEAR, true).decision).toBe("fits");
    expect(judgeRecord(record, PERSON, YEAR, false).decision).toBe("undecided");
  });

  it("leaves a record page undecided when it confirms none of the identifiers compared", () => {
    const record = { heading: "Jordan Example", text: "Jordan Example\nNothing else here" };
    expect(judgeRecord(record, PERSON, YEAR, true).decision).toBe("undecided");
  });

  it("calls a record page a fit on the name alone when the person has nothing else to compare", () => {
    const record = { heading: "Jordan Example", text: "Jordan Example\nNothing else here" };
    const named = { first_name: "Jordan", last_name: "Example" };
    expect(judgeRecord(record, named, YEAR, true).decision).toBe("fits");
  });
});

describe("a card that shows less detail", () => {
  it("does not contradict the person when it shows only the matching state", () => {
    const answer = check("Jordan Example", "Jordan Example\nTX\nAge 36");
    expect(answer).toContain("place: not shown");
    expect(answer).not.toContain("contradicts");
  });

  it("contradicts the person when it shows a different state", () => {
    expect(check("Jordan Example", "Jordan Example\nCA")).toContain("place: absent");
    expect(check("Jordan Example", "Jordan Example\nLives in California")).toContain(
      "place: absent",
    );
  });

  it("contradicts the person when it shows another city in the person's state", () => {
    expect(check("Jordan Example", "Jordan Example\nDallas, TX")).toContain("place: absent");
    expect(check("Jordan Example", "Jordan Example\nDallas TX 75201")).toContain("place: absent");
  });

  it("finds the place without a comma", () => {
    expect(check("Jordan Example", "Jordan Example\nLives in Austin TX 78701")).toContain(
      "place: found in current or past places",
    );
  });

  it("does not take a credential for a state", () => {
    expect(check("Jordan Example", "Jordan Example\nJordan Example MD")).toContain(
      "place: not shown",
    );
  });

  it("leaves a last initial or a cut-off last name undecided instead of different", () => {
    for (const heading of ["Jordan E.", "Jordan E", "Jordan Exam", "J. Example"]) {
      const answer = check(heading, `${heading}\nAustin, TX`);
      expect(answer, heading).toContain("name: not shown");
      expect(answer, heading).not.toContain("contradicts");
    }
  });

  it("still contradicts a last initial or a name that is not the person's", () => {
    expect(check("Jordan K.", "Jordan K.\nAustin, TX")).toContain("name: differs");
    expect(check("Jordan Examples", "Jordan Examples\nAustin, TX")).toContain("name: differs");
  });
});

describe("a record page with other people on it", () => {
  const person = { ...PERSON, birth_year: "1990" };

  it("does not read the age or the city of relatives listed on the lines under the label", () => {
    const text = "Jordan Example\nPossible relatives\nSam Example\nAustin, TX\nAge 61";
    const answer = check("Jordan Example", text, person, true);
    expect(answer).toContain("place: not shown");
    expect(answer).toContain("age: not shown");
  });

  it("leaves a page undecided when only another person's city is in its sidebar", () => {
    const text = "Jordan Example\nPeople also viewed\nSam Example\nAustin, TX\nAge 36";
    const judged = judgeRecord({ heading: "Jordan Example", text }, person, YEAR, true);
    expect(judged.decision).toBe("undecided");
  });

  it("keeps the record's own age after a list of relatives who carry their details on their own lines", () => {
    const text =
      "Jordan Example\nRelatives:\nSam Example - Dallas, TX, age 61\nAge: 36\nCurrent address: Austin, TX";
    const answer = check("Jordan Example", text, person, true);
    expect(answer).toContain("age: fits");
    expect(answer).toContain("place: found in current or past places");
    expect(answer).toContain("fits: include it in your report");
  });

  it("gives a relative's age and city on the lines under a bare name to the relative", () => {
    const text = "Jordan Example\nRelatives\nSam Example\nDallas, TX\nAge 61\nAge: 36\nAustin, TX";
    const answer = check("Jordan Example", text, person, true);
    expect(answer).toContain("age: fits");
  });

  it("reads another city of the person's state written with the state's name", () => {
    expect(check("Jordan Example", "Jordan Example\nRound Rock, Texas 78664")).toContain(
      "place: absent",
    );
  });

  it("reads a state shown beside an age", () => {
    expect(check("Jordan E.", "Jordan E.\nCA | (36)")).toContain("place: absent");
  });

  it("reads an age written in brackets", () => {
    expect(check("Jordan Example", "Jordan Example (36)\nAustin, TX")).toContain("age: fits");
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

describe("an age the page words in another way", () => {
  const ingrid: ProfileFields = {
    first_name: "Ingrid",
    last_name: "Halvorsen",
    city: "Tampa",
    state: "FL",
    birth_year: "1984",
  };
  const onPage = (heading: string, text: string, fields = ingrid) =>
    judgeRecord({ heading, text }, fields, YEAR, true);

  it("reads a decade band as a span, so the 40s fit a 1984 birth year, the 30s are undecided, and the 60s and 20s do not", () => {
    expect(onPage("Ingrid Halvorsen", "In their 40s\nLocated in Tampa, FL").decision).toBe("fits");
    expect(onPage("Ingrid Halvorsen", "In their 60s\nLocated in Tampa, FL").decision).toBe(
      "contradicts",
    );
    expect(onPage("Ingrid Halvorsen", "In their 20s\nLocated in Tampa, FL").decision).toBe(
      "contradicts",
    );
    expect(onPage("Ingrid Halvorsen", "In their 30s\nLocated in Tampa, FL").decision).toBe(
      "undecided",
    );
    expect(
      describeRecordCheck({ heading: "", text: "Ingrid Halvorsen, 40s" }, ingrid, YEAR, false),
    ).toContain("age: fits");
  });

  it("reads a range, with a dash or a word, as a span", () => {
    for (const shown of ["Age 40-44", "Ages 40 to 44", "Age 42-47"]) {
      expect(onPage("Ingrid Halvorsen", `${shown}\nTampa, FL`).decision, shown).toBe("fits");
    }
    expect(onPage("Ingrid Halvorsen", "Ages 60 to 64\nTampa, FL").decision).toBe("contradicts");
  });

  it("reads an age that follows the name after a comma and an age after a colon", () => {
    expect(onPage("", "Ingrid Halvorsen, 31\nTampa, FL").decision).toBe("contradicts");
    expect(onPage("", "Ingrid Halvorsen, 42\nTampa, FL").decision).toBe("fits");
    expect(onPage("Ingrid Halvorsen", "Ages: 42\nTampa, FL").decision).toBe("fits");
  });

  it("does not call an age one or two years stale a contradiction, and does not call it a fit", () => {
    const dana: ProfileFields = {
      ...PERSON,
      first_name: "Dana",
      last_name: "Whitfield",
      birth_year: "1980",
    };
    expect(onPage("Dana Whitfield", "Age 44\nAustin, TX", dana).decision).toBe("undecided");
    expect(onPage("Dana Whitfield", "Age 42-47\nAustin, TX", dana).decision).toBe("fits");
  });

  it("leaves a record page undecided when it shows an age the checks cannot read", () => {
    const unread = onPage("Ingrid Halvorsen", "Age: forty-two\nLocated in Tampa, FL");
    expect(unread.decision).toBe("undecided");
    expect(unread.lines).toContain("age: not clear");
    expect(onPage("Ingrid Halvorsen", "Located in Tampa, FL").decision).toBe("fits");
    expect(onPage("Ingrid Halvorsen", "Age not listed\nLocated in Tampa, FL").decision).toBe(
      "fits",
    );
  });
});

describe("a name the page words in another way", () => {
  const dana: ProfileFields = {
    first_name: "Dana",
    last_name: "Whitfield",
    city: "Austin",
    state: "TX",
    birth_year: "1980",
  };
  const onPage = (heading: string, text: string) =>
    judgeRecord({ heading, text }, dana, YEAR, true);

  it("does not take a page title such as Background Report for the displayed name", () => {
    for (const heading of ["Background Report", "Public Record"]) {
      const judged = onPage(heading, "Dana Whitfield, Age 46\nAustin, TX");
      expect(judged.decision, heading).toBe("fits");
      expect(judged.clashes, heading).toEqual([]);
    }
  });

  it("still finds a different person in a heading when the page never names this one", () => {
    expect(onPage("Mary Smith", "Mary Smith, Age 46\nAustin, TX").decision).toBe("contradicts");
  });

  it("compares a hyphenated surname part by part", () => {
    expect(onPage("Dana Whitfield-Jones", "Age 46\nAustin, TX").decision).toBe("fits");
    expect(
      judgeRecord(
        { heading: "Dana Whitfield", text: "Age 46\nAustin, TX" },
        { ...dana, last_name: "Whitfield-Jones" },
        YEAR,
        true,
      ).clashes,
    ).toEqual([]);
    expect(onPage("Dana Smith-Jones", "Age 46\nAustin, TX").decision).toBe("contradicts");
  });
});

describe("a city written with a particle", () => {
  const person = (city: string, state: string): ProfileFields => ({
    first_name: "Jordan",
    last_name: "Example",
    city,
    state,
  });

  it("finds Coeur d'Alene and Lake of the Woods", () => {
    expect(check("Jordan Example", "Coeur d'Alene, ID", person("Coeur d'Alene", "ID"))).toContain(
      "place: found",
    );
    expect(
      check("Jordan Example", "Lake of the Woods, MN", person("Lake of the Woods", "MN")),
    ).toContain("place: found");
    expect(check("Jordan Example", "Coeur d'Alene, ID", person("Boise", "ID"))).toContain(
      "place: absent",
    );
  });
});

describe("recordCards on a layout without a heading", () => {
  const card = (over: Partial<CardText>): CardText => ({
    ref: "e1",
    href: "https://a.test/rec/b1",
    heading: "",
    text: "",
    linkText: "",
    ...over,
  });
  const anselm: ProfileFields = {
    first_name: "Anselm",
    last_name: "Bright",
    city: "Boise",
    state: "ID",
    birth_year: "1981",
  };

  it("keeps a card whose link text names the person, though it is longer than a name", () => {
    const kept = recordCards(
      [
        card({
          ref: "e1",
          href: "https://a.test/rec/b1",
          linkText: "Anselm Bright - see public record",
        }),
        card({
          ref: "e2",
          href: "https://a.test/rec/b2",
          linkText: "Anselm Bright - see public record",
        }),
        card({ ref: "e3", href: "https://a.test/about", linkText: "About this site" }),
      ],
      anselm,
    );
    expect(kept.map((c) => c.ref)).toEqual(["e1", "e2"]);
  });

  it("keeps cards that all say Open full report when their addresses share one shape", () => {
    const kept = recordCards(
      [
        card({
          ref: "e1",
          href: "https://a.test/report/m1",
          linkText: "Open full report",
          text: "Yusuf Marchetti Arizona Open full report",
        }),
        card({ ref: "e2", href: "https://a.test/report/m2", linkText: "Open full report" }),
        card({ ref: "e3", href: "https://a.test/contact", linkText: "Contact us" }),
      ],
      anselm,
    );
    expect(kept.map((c) => c.ref)).toEqual(["e1", "e2"]);
  });

  it("does not take a generic link such as View Full Report for a record on its own", () => {
    const kept = recordCards(
      [card({ ref: "e1", href: "https://a.test/x", linkText: "View Full Report" })],
      anselm,
    );
    expect(kept).toEqual([]);
  });

  it("does not take pager links of one shape for records", () => {
    const kept = recordCards(
      [
        card({ ref: "e1", href: "https://a.test/results/2", linkText: "2" }),
        card({ ref: "e2", href: "https://a.test/results/3", linkText: "Next page" }),
      ],
      anselm,
    );
    expect(kept).toEqual([]);
  });
});

describe("a place given under City and State labels", () => {
  const yusuf: ProfileFields = {
    first_name: "Yusuf",
    last_name: "Marchetti",
    city: "Phoenix",
    state: "AZ",
    birth_year: "1976",
  };
  const report = (city: string, age: number) => ({
    heading: "Report summary",
    text: `Name\tYusuf Marchetti\nAge\t${age}\nCity\t${city}\nState\tArizona`,
  });

  it("finds the person's city in a table and tells another city in the state apart", () => {
    expect(judgeRecord(report("Phoenix", 50), yusuf, YEAR, true).decision).toBe("fits");
    const other = judgeRecord(report("Tucson", 50), yusuf, YEAR, true);
    expect(other.decision).toBe("contradicts");
    expect(other.clashes).toEqual(["place differs"]);
  });
});
