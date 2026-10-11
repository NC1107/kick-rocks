import { describe, expect, it } from "vitest";
import { detailsOf } from "./candidate-details.js";

describe("the details of a candidate", () => {
  it("takes the name from the heading, the first age, and the places outside the relatives", () => {
    const details = detailsOf({
      heading: "Jordan A Example",
      linkText: "Jordan A Example",
      text: "Jordan A Example\nAge 36 · Austin, TX\nAlso lived in: Tulsa, OK; Dallas, TX.\nPossible relatives: Dana Example, Pat Smith (61), Riley Other\nAge 61",
    });
    expect(details).toMatchObject({
      name: "Jordan A Example",
      age: 36,
      locations: ["Austin, TX", "Tulsa, OK", "Dallas, TX"],
      relatives: ["Dana Example", "Pat Smith", "Riley Other"],
    });
  });

  it("never counts a place on a relatives line as the person's, and ignores a relative's age", () => {
    const details = detailsOf({
      heading: "Jordan Example",
      linkText: "",
      text: "Jordan Example\nRelatives: Sam Example - Houston, TX; Casey Example, age 70\nBorn 1990",
    });
    expect(details.locations).toEqual([]);
    expect(details.age).toBeUndefined();
  });

  it("follows a list of relatives that goes on over the next lines", () => {
    const details = detailsOf({
      heading: "Jordan Example",
      linkText: "",
      text: "Jordan Example\nPossible relatives:\nDana Example\nPat Example\nPrevious addresses: Reno, NV",
    });
    expect(details.relatives).toEqual(["Dana Example", "Pat Example"]);
    expect(details.locations).toEqual(["Reno, NV"]);
  });

  it("finds phones and emails by pattern, once each", () => {
    const details = detailsOf({
      heading: "Jordan Example",
      linkText: "",
      text: "Phones: (512) 555-0100, 512-555-0199, (512) 555-0100\nEmails: old.address@example.org, Old.Address@example.org\nBorn 1990",
    });
    expect(details.phones).toEqual(["(512) 555-0100", "512-555-0199"]);
    expect(details.emails).toEqual(["old.address@example.org"]);
  });

  it("does not take a year or an age for a phone", () => {
    const details = detailsOf({
      heading: "Jordan Example",
      linkText: "",
      text: "Age 36 · born 1990",
    });
    expect(details.phones).toEqual([]);
  });

  it("names the record by its link when the card has no heading, and by the first name-like line when neither is a name", () => {
    expect(detailsOf({ heading: "", linkText: "Jordan Example", text: "Austin, TX" }).name).toBe(
      "Jordan Example",
    );
    expect(
      detailsOf({ heading: "Public record", linkText: "View", text: "Jordan Example\nAustin, TX" })
        .name,
    ).toBe("Jordan Example");
    expect(detailsOf({ heading: "", linkText: "", text: "no name here" }).name).toBe("");
  });

  it("skips a place whose state is not a state", () => {
    const details = detailsOf({
      heading: "Jordan Example",
      linkText: "",
      text: "Jordan Example\nLos Angeles, ZZ\nReno, NV",
    });
    expect(details.locations).toEqual(["Reno, NV"]);
  });

  it("takes the relatives who are listed with their own cities, and not the cities", () => {
    const details = detailsOf({
      heading: "Jordan Example",
      linkText: "",
      text: "Jordan Example\nRelatives\nSam Example - New Braunfels, TX\nCasey Example\nAustin, TX\nAge 70\nBorn 1990",
    });
    expect(details.relatives).toEqual(["Sam Example", "Casey Example"]);
    expect(details.locations).toEqual([]);
  });

  it("leaves out the people, phones and emails of a block about other people", () => {
    const details = detailsOf({
      heading: "Jordan Example",
      linkText: "",
      text: "Jordan Example\nAge 36 · Austin, TX\nPhone (512) 555-0100\nPeople also viewed\nSam Other\nDallas, TX\n(214) 555-0199\nSam@other.test",
    });
    expect(details.locations).toEqual(["Austin, TX"]);
    expect(details.phones).toEqual(["(512) 555-0100"]);
    expect(details.emails).toEqual([]);
    expect(details.relatives).toEqual([]);
  });

  it("drops an email address on the site's own domain", () => {
    const text =
      "Jordan Example\njordan@mail.test\nQuestions: help@people-finder.test\nsupport@eu.people-finder.test";
    const details = detailsOf({ heading: "Jordan Example", linkText: "", text }, [
      "people-finder.test",
    ]);
    expect(details.emails).toEqual(["jordan@mail.test"]);
  });
});
