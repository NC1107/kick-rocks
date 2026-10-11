import { describe, expect, it } from "vitest";
import {
  describeReason,
  describeReasons,
  parseAgeText,
  type ScoreProfile,
  scoreCandidate,
} from "./match-score.js";

const TODAY = "2026-10-11";

const profile: ScoreProfile = {
  names: [
    { first: "Nick", middle: "Paul", last: "Conn" },
    { first: "Nicholas", last: "Conn" },
  ],
  birth: "2001-03-02",
  addresses: [
    { city: "Baltimore", state: "MD", current: true },
    { city: "Aberdeen", state: "MD", current: false },
  ],
  phones: ["+15555550123"],
  emails: ["nick@example.com"],
};

const candidate = { name: "Nick Conn", locations: [] as string[] };

const weightOf = (result: ReturnType<typeof scoreCandidate>, kind: string) =>
  result.reasons.find((reason) => reason.kind === kind)?.weight;

describe("age", () => {
  it("calls age 47 against a person who is 25 unlikely", () => {
    const result = scoreCandidate(
      { ...candidate, age: 47, locations: ["Baltimore, MD"] },
      profile,
      TODAY,
    );
    expect(weightOf(result, "age")).toBe("contradicts");
    expect(result.band).toBe("unlikely");
    expect(describeReasons(result.reasons)).toContain("Age 47, you are 25");
  });

  it("treats one year off as strong", () => {
    const result = scoreCandidate({ ...candidate, age: 26 }, profile, TODAY);
    expect(weightOf(result, "age")).toBe("strong");
    expect(scoreCandidate({ ...candidate, age: 27 }, profile, TODAY).reasons).toContainEqual(
      expect.objectContaining({ kind: "age", weight: "strong" }),
    );
  });

  it("treats three to five years off as weak and six as contradicting", () => {
    expect(weightOf(scoreCandidate({ ...candidate, age: 28 }, profile, TODAY), "age")).toBe("weak");
    expect(weightOf(scoreCandidate({ ...candidate, age: 30 }, profile, TODAY), "age")).toBe("weak");
    expect(weightOf(scoreCandidate({ ...candidate, age: 31 }, profile, TODAY), "age")).toBe(
      "contradicts",
    );
  });

  it("counts a birthday that has not come yet this year", () => {
    const born = { ...profile, birth: "2001-12-31" };
    const result = scoreCandidate({ ...candidate, age: 24 }, born, TODAY);
    expect(result.reasons[1]).toMatchObject({ kind: "age", profile: { low: 24, high: 24 } });
  });

  it("allows a year of slack when the profile has only a birth year", () => {
    const yearOnly = { ...profile, birth: "2001" };
    expect(weightOf(scoreCandidate({ ...candidate, age: 24 }, yearOnly, TODAY), "age")).toBe(
      "strong",
    );
    expect(weightOf(scoreCandidate({ ...candidate, age: 25 }, yearOnly, TODAY), "age")).toBe(
      "strong",
    );
  });

  it("contradicts on a range only when the whole range is outside five years", () => {
    const decade = parseAgeText("In their 40s");
    expect(decade).toEqual({ low: 40, high: 49 });
    const far = scoreCandidate({ ...candidate, ageRange: decade ?? undefined }, profile, TODAY);
    expect(weightOf(far, "age")).toBe("contradicts");

    const near = scoreCandidate({ ...candidate, ageRange: { low: 20, high: 29 } }, profile, TODAY);
    expect(weightOf(near, "age")).toBe("weak");

    const touching = scoreCandidate(
      { ...candidate, ageRange: { low: 30, high: 40 } },
      profile,
      TODAY,
    );
    expect(weightOf(touching, "age")).toBe("weak");
    expect(describeReason(touching.reasons[1] as never)).toBe("Age 30-40, you are 25");

    const narrow = scoreCandidate(
      { ...candidate, ageRange: { low: 24, high: 27 } },
      profile,
      TODAY,
    );
    expect(weightOf(narrow, "age")).toBe("strong");
  });

  it("reads a candidate birth year as an age", () => {
    const result = scoreCandidate({ ...candidate, birthYear: 1979 }, profile, TODAY);
    expect(weightOf(result, "age")).toBe("contradicts");
  });

  it("parses the ways a card states an age", () => {
    expect(parseAgeText("Age 47")).toEqual({ low: 47, high: 47 });
    expect(parseAgeText("Ages 42-47")).toEqual({ low: 42, high: 47 });
    expect(parseAgeText("42 to 47")).toEqual({ low: 42, high: 47 });
    expect(parseAgeText("nothing")).toBeNull();
  });
});

describe("places", () => {
  it("is strong for a past address in the same city", () => {
    const result = scoreCandidate({ ...candidate, locations: ["Aberdeen, MD"] }, profile, TODAY);
    expect(result.reasons).toContainEqual({
      kind: "place",
      weight: "strong",
      city: "Aberdeen",
      state: "MD",
      past: true,
    });
    expect(describeReasons(result.reasons)).toContain("Lived in Aberdeen, MD");
  });

  it("prefers the current address when both match", () => {
    const result = scoreCandidate(
      { ...candidate, locations: ["Aberdeen, MD", "baltimore, md"] },
      profile,
      TODAY,
    );
    expect(describeReasons(result.reasons)).toContain("Lives in Baltimore, MD");
  });

  it("is weak for the same state only", () => {
    const result = scoreCandidate({ ...candidate, locations: ["Salisbury, MD"] }, profile, TODAY);
    expect(weightOf(result, "place")).toBe("weak");
    expect(describeReasons(result.reasons)).toContain("Same state, MD");
  });

  it("is neutral, not negative, with no overlap", () => {
    const withPlace = scoreCandidate({ ...candidate, locations: ["Austin, TX"] }, profile, TODAY);
    const without = scoreCandidate(candidate, profile, TODAY);
    expect(weightOf(withPlace, "place")).toBe("neutral");
    expect(withPlace.score).toBe(without.score);
  });
});

describe("names", () => {
  it("is strong for the exact name and for a known variant", () => {
    const exact = scoreCandidate(candidate, profile, TODAY);
    expect(exact.reasons[0]).toMatchObject({ kind: "name", weight: "strong", via: "exact" });
    const variant = scoreCandidate({ ...candidate, name: "Nicholas Conn" }, profile, TODAY);
    expect(variant.reasons[0]).toMatchObject({ kind: "name", weight: "strong", via: "variant" });
    expect(describeReason(variant.reasons[0] as never)).toBe("Known name");
  });

  it("reads punctuation, case, suffixes and Last, First order", () => {
    for (const name of ["NICK P. CONN", "Conn, Nick", "Nick Conn Jr."]) {
      expect(scoreCandidate({ ...candidate, name }, profile, TODAY).reasons[0]).toMatchObject({
        kind: "name",
        weight: "strong",
      });
    }
  });

  it("weighs a different middle initial weakly against", () => {
    const result = scoreCandidate({ ...candidate, name: "Nick R. Conn" }, profile, TODAY);
    expect(result.reasons[0]).toMatchObject({ kind: "name", weight: "weak_against" });
    expect(result.score).toBeLessThan(scoreCandidate(candidate, profile, TODAY).score);
    expect(result.band).toBe("maybe");
  });

  it("says nothing about a name that is not the person's", () => {
    expect(scoreCandidate({ ...candidate, name: "Sam Smith" }, profile, TODAY).reasons).toEqual([]);
  });
});

describe("phones and emails", () => {
  it("is strong on any overlap, however the number is written", () => {
    const result = scoreCandidate(
      { ...candidate, phones: ["(555) 555-0123"], emails: ["NICK@example.com"] },
      profile,
      TODAY,
    );
    expect(describeReasons(result.reasons)).toEqual(
      expect.arrayContaining(["Phone matches", "Email matches"]),
    );
    expect(result.band).toBe("likely");
  });

  it("does not count a phone that is different", () => {
    const result = scoreCandidate({ ...candidate, phones: ["555-555-9999"] }, profile, TODAY);
    expect(weightOf(result, "phone")).toBeUndefined();
  });
});

describe("no data", () => {
  it("is a maybe with no reasons when nothing can be compared", () => {
    const result = scoreCandidate({ name: "X" }, { names: [] }, TODAY);
    expect(result).toEqual({ band: "maybe", score: 50, reasons: [] });
  });

  it("does not count a missing date of birth against the candidate", () => {
    const result = scoreCandidate({ ...candidate, age: 47 }, { ...profile, birth: null }, TODAY);
    expect(weightOf(result, "age")).toBeUndefined();
  });

  it("is likely when everything agrees", () => {
    const result = scoreCandidate(
      { ...candidate, age: 25, locations: ["Aberdeen, MD"] },
      profile,
      TODAY,
    );
    expect(result.band).toBe("likely");
  });

  it("never lets a contradicted age read as likely, even with a phone match", () => {
    const result = scoreCandidate(
      { ...candidate, age: 40, phones: ["5555550123"], locations: ["Baltimore, MD"] },
      profile,
      TODAY,
    );
    expect(result.band).toBe("maybe");
  });
});

describe("chips", () => {
  it("names the candidate age and the person's own", () => {
    const result = scoreCandidate({ ...candidate, age: 47 }, profile, TODAY);
    expect(describeReason(result.reasons[1] as never)).toBe("Age 47, you are 25");
  });
});
