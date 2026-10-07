import type { Identity } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  addDraft,
  defaultDisplayName,
  emptyDraft,
  hasErrors,
  type IdentityDraft,
  localToday,
  makePrimary,
  normalizePhone,
  normalizePrimaries,
  removeDraft,
  serverErrors,
  snapshot,
  startingDrafts,
  toDrafts,
  toInputs,
  updateDraft,
  validateDrafts,
} from "./identity-drafts.js";

const TODAY = "2026-10-07";

function filled(overrides: Partial<IdentityDraft> & Pick<IdentityDraft, "kind">): IdentityDraft {
  return { ...emptyDraft(overrides.kind), ...overrides };
}

function validProfile(): IdentityDraft[] {
  return normalizePrimaries([
    filled({ kind: "name", first: "Jordan", last: "Example" }),
    filled({ kind: "email", address: "jordan@example.com" }),
  ]);
}

describe("primaries", () => {
  it("starts a new profile with one primary name and one primary email", () => {
    const drafts = startingDrafts();
    expect(drafts.map((draft) => [draft.kind, draft.isPrimary])).toEqual([
      ["name", true],
      ["email", true],
    ]);
  });

  it("makes the first row of a kind primary and leaves later rows alone", () => {
    const drafts = addDraft(addDraft(startingDrafts(), "email"), "phone");
    const emails = drafts.filter((draft) => draft.kind === "email");
    expect(emails.map((draft) => draft.isPrimary)).toEqual([true, false]);
    expect(drafts.find((draft) => draft.kind === "phone")?.isPrimary).toBe(true);
  });

  it("never gives an alias a primary", () => {
    const drafts = addDraft(startingDrafts(), "alias");
    expect(drafts.find((draft) => draft.kind === "alias")?.isPrimary).toBe(false);
    const forced = normalizePrimaries([{ ...emptyDraft("alias"), isPrimary: true }]);
    expect(forced[0]?.isPrimary).toBe(false);
  });

  it("moves the primary to another row of the same kind only", () => {
    let drafts = addDraft(startingDrafts(), "email");
    const [first, second] = drafts.filter((draft) => draft.kind === "email");
    drafts = makePrimary(drafts, second?.key ?? "");
    expect(drafts.find((draft) => draft.key === first?.key)?.isPrimary).toBe(false);
    expect(drafts.find((draft) => draft.key === second?.key)?.isPrimary).toBe(true);
    expect(drafts.find((draft) => draft.kind === "name")?.isPrimary).toBe(true);
  });

  it("promotes the next row when the primary is removed", () => {
    let drafts = addDraft(startingDrafts(), "email");
    const [first, second] = drafts.filter((draft) => draft.kind === "email");
    drafts = removeDraft(drafts, first?.key ?? "");
    expect(drafts.find((draft) => draft.key === second?.key)?.isPrimary).toBe(true);
  });

  it("repairs stored data that has two primaries or none", () => {
    const stored: Identity[] = [
      {
        id: "a",
        kind: "email",
        value: { address: "a@example.com" },
        isPrimary: true,
        validFrom: null,
        validTo: null,
      },
      {
        id: "b",
        kind: "email",
        value: { address: "b@example.com" },
        isPrimary: true,
        validFrom: null,
        validTo: null,
      },
      {
        id: "c",
        kind: "phone",
        value: { number: "+15555550123" },
        isPrimary: false,
        validFrom: null,
        validTo: null,
      },
    ];
    const drafts = toDrafts(stored);
    expect(drafts.filter((draft) => draft.kind === "email" && draft.isPrimary)).toHaveLength(1);
    expect(drafts.find((draft) => draft.kind === "phone")?.isPrimary).toBe(true);
  });
});

describe("normalizePhone", () => {
  it.each([
    ["(555) 555-0123", "+15555550123"],
    ["555-555-0123", "+15555550123"],
    ["1 555 555 0123", "+15555550123"],
    ["+1 (555) 555-0123", "+15555550123"],
    ["+44 20 7946 0958", "+442079460958"],
    ["  ", ""],
  ])("reads %s as %s", (typed, expected) => {
    expect(normalizePhone(typed)).toBe(expected);
  });

  it("leaves a number it cannot read so validation can explain it", () => {
    expect(normalizePhone("555-0123")).toBe("555-0123");
  });
});

describe("toInputs", () => {
  it("trims, drops an empty middle name and unit, and turns empty dates into null", () => {
    const drafts = [
      filled({
        kind: "name",
        isPrimary: true,
        first: " Jordan ",
        middle: "  ",
        last: "Example",
      }),
      filled({
        kind: "address",
        isPrimary: true,
        street: "100 Example Street",
        unit: "",
        city: "Sampleton",
        state: "CA",
        zip: "90000",
        validFrom: "2022-03-01",
      }),
    ];
    expect(toInputs(drafts)).toEqual([
      {
        kind: "name",
        value: { first: "Jordan", last: "Example" },
        isPrimary: true,
        validFrom: null,
        validTo: null,
      },
      {
        kind: "address",
        value: {
          street: "100 Example Street",
          city: "Sampleton",
          state: "CA",
          zip: "90000",
        },
        isPrimary: true,
        validFrom: "2022-03-01",
        validTo: null,
      },
    ]);
  });

  it("round trips stored identities", () => {
    const stored: Identity[] = [
      {
        id: "n",
        kind: "name",
        value: { first: "Jordan", middle: "Q", last: "Example" },
        isPrimary: true,
        validFrom: null,
        validTo: null,
      },
      {
        id: "d",
        kind: "dob",
        value: { date: "1990-04-12" },
        isPrimary: true,
        validFrom: null,
        validTo: null,
      },
    ];
    const inputs = toInputs(toDrafts(stored));
    expect(inputs).toEqual(stored.map(({ id: _id, ...rest }) => rest));
  });
});

describe("validateDrafts", () => {
  it("accepts a minimal valid profile", () => {
    expect(hasErrors(validateDrafts(validProfile(), TODAY))).toBe(false);
  });

  it("says Required for blank fields instead of a schema message", () => {
    const errors = validateDrafts(startingDrafts(), TODAY);
    expect(errors.fields["0.value.first"]).toBe("Required");
    expect(errors.fields["0.value.last"]).toBe("Required");
    expect(errors.fields["1.value.address"]).toBe("Required");
  });

  it("explains an invalid email, phone, ZIP, and state", () => {
    const drafts = normalizePrimaries([
      filled({ kind: "name", first: "Jordan", last: "Example" }),
      filled({ kind: "email", address: "not an email" }),
      filled({ kind: "phone", number: "555-0123" }),
      filled({
        kind: "address",
        street: "1 Example Street",
        city: "Sampleton",
        state: "",
        zip: "9",
      }),
    ]);
    const { fields } = validateDrafts(drafts, TODAY);
    expect(fields["1.value.address"]).toBe("Enter a valid email address");
    expect(fields["2.value.number"]).toMatch(/area code/);
    expect(fields["3.value.state"]).toBe("Required");
    expect(fields["3.value.zip"]).toMatch(/5 digit/);
  });

  it("asks for a name and an email when the profile has none", () => {
    const errors = validateDrafts([], TODAY);
    expect(errors.sections.name).toMatch(/Add a name/);
    expect(errors.sections.email).toMatch(/at least one email/);
  });

  it("rejects an end date before the start date, on the end date", () => {
    const drafts = [
      ...validProfile(),
      filled({
        kind: "address",
        isPrimary: true,
        street: "22 Placeholder Lane",
        city: "Testville",
        state: "CA",
        zip: "90001",
        validFrom: "2020-05-01",
        validTo: "2019-01-01",
      }),
    ];
    expect(validateDrafts(drafts, TODAY).fields["2.validTo"]).toMatch(/before the start/);
  });

  it("rejects a birth date in the future or before 1900", () => {
    const future = [
      ...validProfile(),
      filled({ kind: "dob", isPrimary: true, date: "2030-01-01" }),
    ];
    expect(validateDrafts(future, TODAY).fields["2.value.date"]).toMatch(/not plausible/);
    const old = [...validProfile(), filled({ kind: "dob", isPrimary: true, date: "1850-01-01" })];
    expect(validateDrafts(old, TODAY).fields["2.value.date"]).toMatch(/not plausible/);
    const fine = [...validProfile(), filled({ kind: "dob", isPrimary: true, date: TODAY })];
    expect(hasErrors(validateDrafts(fine, TODAY))).toBe(false);
  });

  it("flags a repeated email address, ignoring case", () => {
    const drafts = [...validProfile(), filled({ kind: "email", address: "Jordan@Example.com" })];
    expect(validateDrafts(drafts, TODAY).fields["2.value.address"]).toBe("Already listed above");
  });

  it("accepts a phone typed the way people type it", () => {
    const drafts = [
      ...validProfile(),
      filled({ kind: "phone", isPrimary: true, number: "(555) 555-0123" }),
    ];
    expect(hasErrors(validateDrafts(drafts, TODAY))).toBe(false);
  });

  it("reports a rule about two primaries as a section error", () => {
    const drafts = validProfile().map((draft) => ({ ...draft, isPrimary: true }));
    const more = [
      ...drafts,
      { ...filled({ kind: "email", address: "b@example.com" }), isPrimary: true },
    ];
    expect(validateDrafts(more, TODAY).sections.email).toMatch(/only one primary email/i);
  });
});

describe("serverErrors", () => {
  it("puts identity field errors on their rows and the rest above the form", () => {
    const errors = serverErrors({
      "identities.1.value.address": "Enter a valid email",
      "identities.0.validTo": "Must not be before the start date",
      identities: "Something about the whole list",
    });
    expect(errors.fields["1.value.address"]).toBe("Enter a valid email");
    expect(errors.fields["0.validTo"]).toBe("Must not be before the start date");
    expect(errors.general).toEqual(["Something about the whole list"]);
  });

  it("sends the server's primary and email rules to their sections", () => {
    const errors = serverErrors({ identities: "At least one email is required" });
    expect(errors.sections.email).toBeDefined();
    expect(errors.general).toEqual([]);
  });
});

describe("helpers", () => {
  it("detects edits through the snapshot", () => {
    const drafts = validProfile();
    const before = snapshot(drafts);
    const first = drafts[0];
    expect(snapshot(updateDraft(drafts, first?.key ?? "", { first: "Jo" }))).not.toBe(before);
    expect(snapshot(drafts)).toBe(before);
  });

  it("names a profile after its primary name", () => {
    const drafts = [
      filled({ kind: "name", isPrimary: true, first: "Jordan", middle: "Q", last: "Example" }),
      filled({ kind: "name", first: "Other", last: "Person" }),
    ];
    expect(defaultDisplayName(drafts)).toBe("Jordan Q Example");
    expect(defaultDisplayName([])).toBe("");
  });

  it("formats today in local time", () => {
    expect(localToday(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
  });
});
