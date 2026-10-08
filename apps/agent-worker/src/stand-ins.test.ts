import { describe, expect, it } from "vitest";
import { type DropdownOption, detailAskedFor, stateSpellings } from "./stand-ins.js";

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

describe("stateSpellings", () => {
  it("gives both the code and the name for either", () => {
    expect(stateSpellings("TX")).toEqual(["TX", "Texas"]);
    expect(stateSpellings("texas")).toEqual(["TX", "Texas"]);
  });

  it("gives back a value that is no state as it is", () => {
    expect(stateSpellings("Ontario")).toEqual(["Ontario"]);
  });
});
