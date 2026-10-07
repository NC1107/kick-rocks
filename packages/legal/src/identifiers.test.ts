import { describe, expect, it } from "vitest";
import { COMPANY, jordan, makeTarget, PEOPLE_SEARCH } from "./fixtures.js";
import { identifiersFor, LegalInputError } from "./index.js";

const AS_OF = new Date("2026-10-07T12:00:00Z");
const BROKER = makeTarget();

describe("identifiersFor email", () => {
  it("gives a blind email to a marketing broker a name and an email only", () => {
    expect(identifiersFor(BROKER, jordan(), "email", [], AS_OF)).toEqual({
      full_name: "Jordan Q Example",
      email: "jordan@example.org",
    });
  });

  it("gives a registered broker a name and an email only", () => {
    const target = makeTarget({ category: "registered-broker" });
    expect(Object.keys(identifiersFor(target, jordan(), "email", [], AS_OF)).sort()).toEqual([
      "email",
      "full_name",
    ]);
  });

  it("gives a company a name and an email only", () => {
    expect(Object.keys(identifiersFor(COMPANY, jordan(), "email", [], AS_OF)).sort()).toEqual([
      "email",
      "full_name",
    ]);
  });

  it("adds city and state for people-search and background-check requests", () => {
    for (const target of [
      PEOPLE_SEARCH,
      makeTarget({ category: "background-check", needsRecord: true }),
    ]) {
      expect(identifiersFor(target, jordan(), "email", [], AS_OF)).toEqual({
        full_name: "Jordan Q Example",
        email: "jordan@example.org",
        city: "Springfield",
        state: "TX",
      });
    }
  });

  it("never discloses date of birth, street, phone, or zip unless asked", () => {
    for (const target of [BROKER, PEOPLE_SEARCH, COMPANY]) {
      for (const purpose of ["email", "scan", "remove"] as const) {
        const fields = identifiersFor(target, jordan(), purpose, [], AS_OF);
        for (const forbidden of ["date_of_birth", "birth_year", "street", "phone", "zip"]) {
          expect(fields, `${target.id} ${purpose}`).not.toHaveProperty(forbidden);
        }
      }
    }
  });

  it("adds exactly the fields a verification reply asked for", () => {
    const fields = identifiersFor(BROKER, jordan(), "email", ["date_of_birth", "street"], AS_OF);
    expect(fields).toEqual({
      full_name: "Jordan Q Example",
      email: "jordan@example.org",
      date_of_birth: "1990-04-02",
      street: "12 Example Street 4B",
    });
  });

  it("does not repeat a field that is both base and requested", () => {
    const fields = identifiersFor(PEOPLE_SEARCH, jordan(), "email", ["city", "email"], AS_OF);
    expect(Object.keys(fields).sort()).toEqual(["city", "email", "full_name", "state"]);
  });

  it("omits a requested field the person has no identity for", () => {
    const withoutDob = jordan().filter((identity) => identity.kind !== "dob");
    expect(identifiersFor(BROKER, withoutDob, "email", ["date_of_birth"], AS_OF)).toEqual({
      full_name: "Jordan Q Example",
      email: "jordan@example.org",
    });
  });
});

describe("identifiersFor scan and remove", () => {
  it("scans with a name and location only", () => {
    expect(identifiersFor(PEOPLE_SEARCH, jordan(), "scan", [], AS_OF)).toEqual({
      first_name: "Jordan",
      last_name: "Example",
      city: "Springfield",
      state: "TX",
    });
  });

  it("removes with names and the email, plus location only where a record is needed", () => {
    expect(Object.keys(identifiersFor(BROKER, jordan(), "remove", [], AS_OF)).sort()).toEqual([
      "email",
      "first_name",
      "full_name",
      "last_name",
    ]);
    expect(
      Object.keys(identifiersFor(PEOPLE_SEARCH, jordan(), "remove", [], AS_OF)).sort(),
    ).toEqual(["city", "email", "first_name", "full_name", "last_name", "state"]);
  });

  it("adds what a recipe declares", () => {
    const fields = identifiersFor(PEOPLE_SEARCH, jordan(), "remove", ["birth_year", "zip"], AS_OF);
    expect(fields).toMatchObject({ birth_year: "1990", zip: "75001" });
  });
});

describe("identifiersFor dates and errors", () => {
  it("uses the address in force on the date", () => {
    const early = identifiersFor(
      PEOPLE_SEARCH,
      jordan(),
      "email",
      [],
      new Date("2019-06-01T00:00:00Z"),
    );
    expect(early).toMatchObject({ city: "Oldtown", state: "OR" });
    const now = identifiersFor(PEOPLE_SEARCH, jordan(), "email", [], AS_OF);
    expect(now).toMatchObject({ city: "Springfield", state: "TX" });
  });

  it("defaults the date to today", () => {
    expect(identifiersFor(PEOPLE_SEARCH, jordan(), "email")).toMatchObject({ state: "TX" });
  });

  it("returns an empty set for no identities instead of failing", () => {
    expect(identifiersFor(BROKER, [], "email", [], AS_OF)).toEqual({});
  });

  it("rejects an unknown purpose, field, or date", () => {
    expect(() => identifiersFor(BROKER, jordan(), "mail" as never)).toThrow(LegalInputError);
    expect(() => identifiersFor(BROKER, jordan(), "email", ["ssn" as never])).toThrow(
      LegalInputError,
    );
    expect(() => identifiersFor(BROKER, jordan(), "email", [], new Date("nope"))).toThrow(
      LegalInputError,
    );
  });
});
