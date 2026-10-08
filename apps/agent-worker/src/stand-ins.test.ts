import { describe, expect, it } from "vitest";
import { birthKeys, type DropdownOption, detailAskedFor, stateSpellings } from "./stand-ins.js";

const options = (...labels: string[]): DropdownOption[] =>
  labels.map((label) => ({ value: label, label }));

const MONTHS = options(
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
);

const range = (from: number, to: number) =>
  options(...Array.from({ length: to - from + 1 }, (_, i) => String(from + i)));

describe("detailAskedFor", () => {
  it("recognises a date of birth by the page's words", () => {
    expect(detailAskedFor("Date of birth", options("a", "b"))?.words).toBe("date of birth");
    expect(detailAskedFor("dob month", options("a"))?.answeredBy).toEqual(["date_of_birth"]);
  });

  it("recognises the three dropdowns of a date by their shape when the label says nothing", () => {
    expect(detailAskedFor("Month", MONTHS)?.answeredBy).toEqual(["date_of_birth"]);
    expect(detailAskedFor("Day", range(1, 31))?.answeredBy).toEqual(["date_of_birth"]);
    expect(detailAskedFor("Year", range(1920, 2008))?.answeredBy).toEqual([
      "birth_year",
      "date_of_birth",
    ]);
  });

  it("does not take a short range of recent years, or a count, for a birth year", () => {
    expect(detailAskedFor("Year", range(2024, 2030))).toBeNull();
    expect(detailAskedFor("How many", range(1, 10))).toBeNull();
  });

  it("recognises a state by its label or by a list of the states", () => {
    expect(detailAskedFor("Your state", options("a"))?.answeredBy).toEqual(["state"]);
    expect(detailAskedFor("Province", options("a"))?.words).toBe("state");
    const states = options("Alabama", "Alaska", ...range(1, 60).map((o) => o.label));
    expect(detailAskedFor("Where", states)).toBeNull();
  });

  it("recognises a city and a ZIP code by label", () => {
    expect(detailAskedFor("City", options("a"))?.answeredBy).toEqual(["city"]);
    expect(detailAskedFor("Postal code", options("a"))?.answeredBy).toEqual(["zip"]);
  });

  it("leaves a dropdown about the request itself alone", () => {
    expect(detailAskedFor("What is this about", options("Sale of my data", "Deletion"))).toBeNull();
    expect(detailAskedFor("Statement type", options("a"))).toBeNull();
  });
});

describe("a field name written in camel case", () => {
  it("is read word by word, so birthYear, dobMonth, cityName and zipCode are known", () => {
    expect(detailAskedFor("birthYear", options("a"))?.part).toBe("year");
    expect(detailAskedFor("dobMonth", options("a"))?.part).toBe("month");
    expect(detailAskedFor("cityName", options("a"))?.answeredBy).toEqual(["city"]);
    expect(detailAskedFor("zipCode", options("a"))?.answeredBy).toEqual(["zip"]);
  });
});

describe("which part of a date of birth a dropdown asks for", () => {
  it("is the month, the day or the year by the choices", () => {
    expect(detailAskedFor("Month", MONTHS)?.part).toBe("month");
    expect(detailAskedFor("Day", range(1, 31))?.part).toBe("day");
    expect(detailAskedFor("Year", range(1920, 2008))?.part).toBe("year");
    expect(detailAskedFor("Date of birth", options("a", "b"))?.part).toBe("date");
  });
});

describe("birthKeys", () => {
  it("gives the labels a month, day or year dropdown may use for the stored date", () => {
    expect(birthKeys("date_of_birth", "1990-04-05", "month")).toEqual(["4", "04", "april", "apr"]);
    expect(birthKeys("date_of_birth", "1990-04-05", "day")).toEqual(["5", "05"]);
    expect(birthKeys("date_of_birth", "1990-04-05", "year")).toEqual(["1990"]);
    expect(birthKeys("birth_year", "1990", "year")).toEqual(["1990"]);
  });

  it("gives nothing for a part the field does not hold", () => {
    expect(birthKeys("birth_year", "1990", "month")).toBeNull();
    expect(birthKeys("date_of_birth", "not a date", "year")).toBeNull();
  });
});

describe("stateSpellings", () => {
  it("gives both the code and the name for either", () => {
    expect(stateSpellings("TX")).toEqual(["TX", "Texas"]);
    expect(stateSpellings("texas")).toEqual(["TX", "Texas"]);
  });

  it("gives back a value that is no state as it is", () => {
    expect(stateSpellings("Ontario")).toEqual(["Ontario"]);
  });
});
