import { describe, expect, it } from "vitest";
import { createMask, namedHiddenValues, restoreFields } from "./mask.js";

describe("createMask", () => {
  const mask = createMask({
    full_name: "Jordan Example",
    email: "jordan.example@example.com",
    state: "TX",
  });

  it("hides a value however a page or an address spells it", () => {
    expect(mask("Hello, Jordan Example.")).toBe("Hello, {{full_name}}.");
    expect(mask("https://x.test/p?name=Jordan+Example")).toBe(
      "https://x.test/p?name={{full_name}}",
    );
    expect(mask("https://x.test/p?name=Jordan%20Example")).toBe(
      "https://x.test/p?name={{full_name}}",
    );
    expect(mask("https://x.test/jordan-example")).toBe("https://x.test/{{full_name}}");
    expect(mask("mail jordan.example@example.com or jordan.example%40example.com")).toBe(
      "mail {{email}} or {{email}}",
    );
  });

  it("ignores case, and leaves values too short to be safe to replace", () => {
    expect(mask("JORDAN EXAMPLE")).toBe("{{full_name}}");
    expect(mask("Austin, TX")).toBe("Austin, TX");
  });

  it("hides a phone number and a date of birth however a page's input mask spells them", () => {
    const personal = createMask({ phone: "+15125550100", date_of_birth: "1990-04-05" });
    for (const spelling of [
      "(512) 555-0100",
      "512-555-0100",
      "512.555.0100",
      "512 555 0100",
      "5125550100",
      "15125550100",
      "+1 512 555 0100",
      "+15125550100",
    ]) {
      expect(personal(`Call ${spelling} now`)).toBe("Call {{phone}} now");
    }
    expect(personal("Born 04/05/1990")).toBe("Born {{date_of_birth}}");
    expect(personal("Born 4/5/1990 or 1990-04-05")).toBe(
      "Born {{date_of_birth}} or {{date_of_birth}}",
    );
  });

  it("hides a value in every encoding an address or a page can give it", () => {
    const person = createMask({ full_name: "Jordan O'Neil, Jr. #2 & Co" });
    const value = "Jordan O'Neil, Jr. #2 & Co";
    const spellings = [
      value,
      new URLSearchParams({ q: value }).toString().slice(2),
      encodeURIComponent(value),
      encodeURI(value),
      encodeURIComponent(value).toLowerCase(),
      new URLSearchParams({ q: value }).toString().slice(2).toLowerCase(),
      encodeURIComponent(value).replace("%20", "+"),
      "Jordan+O%27Neil,%20Jr.+%232+%26+Co",
      "Jordan O&#39;Neil, Jr. #2 &amp; Co",
    ];
    for (const spelling of spellings) {
      expect(person(`https://x.test/search?name=${spelling}&page=2`)).toBe(
        "https://x.test/search?name={{full_name}}&page=2",
      );
      expect(person(`/people?next=${spelling}`)).toBe("/people?next={{full_name}}");
    }
  });

  it("restores a value where a placeholder stands, and leaves other placeholders alone", () => {
    expect(
      restoreFields("{{first_name}} {{last_name}} {{zip}} {{nope}}", {
        first_name: "Jordan",
        last_name: "Example",
      }),
    ).toBe("Jordan Example {{zip}} {{nope}}");
  });

  describe("with the rest of the profile", () => {
    const fields = { first_name: "Jordan", last_name: "Example" };
    const hidden = [
      "Jordan",
      "Jamie Sample",
      "+15125550100",
      "old.address@example.org",
      "12 Old Mill Road",
      "78701",
      "1990-04-05",
      "1990",
    ];
    const mask = createMask(fields, hidden);
    const named = namedHiddenValues(fields, hidden);
    const nameOf = (value: string) => Object.entries(named).find(([, v]) => v === value)?.[0];

    it("hides each of them under a name of its own, and keeps a task field's name for a repeat", () => {
      expect(mask("Jordan")).toBe("{{first_name}}");
      expect(mask("aka Jamie Sample")).toBe(`aka {{${nameOf("Jamie Sample")}}}`);
      expect(mask("Call (512) 555-0100")).toBe(`Call {{${nameOf("+15125550100")}}}`);
      expect(mask("12 Old Mill Road, TX 78701")).toBe(
        `{{${nameOf("12 Old Mill Road")}}}, TX {{${nameOf("78701")}}}`,
      );
      expect(mask("born 04/05/1990 in 1990")).toBe(
        `born {{${nameOf("1990-04-05")}}} in {{${nameOf("1990")}}}`,
      );
      expect(Object.keys(named)).not.toContain("first_name");
    });

    it("lets the program restore what it hid, and only that", () => {
      const known = { ...fields, ...named };
      expect(restoreFields(mask("Jamie Sample, old.address@example.org"), known)).toBe(
        "Jamie Sample, old.address@example.org",
      );
      expect(restoreFields("{{other_99}}", known)).toBe("{{other_99}}");
    });

    it("ignores blank entries and does not name a value twice", () => {
      expect(namedHiddenValues({}, ["a value", " ", "A VALUE", ""])).toEqual({
        other_1: "a value",
      });
    });
  });

  it("changes nothing when there is nothing to hide", () => {
    expect(createMask({})("Jordan Example")).toBe("Jordan Example");
  });
});
