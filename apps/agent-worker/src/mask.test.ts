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

  it("ignores case, and leaves a short value that is not a state alone", () => {
    expect(mask("JORDAN EXAMPLE")).toBe("{{full_name}}");
    expect(createMask({ city: "Ox" })("Ox lives in Oxford")).toBe("Ox lives in Oxford");
  });

  describe("a state", () => {
    it("hides the postal code as a whole word, and the full name with it", () => {
      expect(mask("Austin, TX 78701")).toBe("Austin, {{state}} 78701");
      expect(mask("Texas, the Lone Star State")).toBe("{{state}}, the Lone Star State");
      expect(mask("state=TX&x=1")).toBe("state={{state}}&x=1");
    });

    it("leaves the same letters inside other words, and in lower case, alone", () => {
      expect(mask("TXT messages, the NEXT TXN")).toBe("TXT messages, the NEXT TXN");
      expect(mask("see tx notes")).toBe("see tx notes");
    });

    it("does not hide a state that is not the person's", () => {
      expect(mask("Portland, OR and Ohio")).toBe("Portland, OR and Ohio");
    });

    it("hides a state the task has no field for, under the name the program gave it", () => {
      const hidden = createMask({ full_name: "Jordan Example" }, ["Jordan Example", "CA"]);
      expect(hidden("Moved from CA in 2019")).toBe("Moved from {{other_1}} in 2019");
      expect(hidden("California")).toBe("{{other_1}}");
    });

    it("matches a state the profile stores as a full name", () => {
      expect(createMask({ state: "Texas" })("Austin, TX and Texas")).toBe(
        "Austin, {{state}} and {{state}}",
      );
    });

    it("does not treat another two-letter value that is not a state code as a state", () => {
      expect(createMask({ city: "Xx" }, ["Xx"])("Xx here")).toBe("Xx here");
    });
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

  it("hides a value that a return address carries inside another address", () => {
    const person = createMask({
      email: "pk1977@mail.test",
      street: "742 Evergreen Terrace",
      last_name: "O'Neil",
    });
    const next = (path: string) => `http://127.0.0.1:8637/login?next=${encodeURIComponent(path)}`;
    const cases: [string, string[]][] = [
      [
        next("/search?email=pk1977%40mail.test&addr=742+Evergreen+Terrace"),
        ["{{email}}", "{{street}}"],
      ],
      [
        "/login?next=%2Fsearch%3Femail%3Dpk1977%2540mail.test%26addr%3D742%2BEvergreen%2BTerrace",
        ["{{email}}", "{{street}}"],
      ],
      ["/x?return=%2Fp%3Fn%3DO%2527Neil", ["{{last_name}}"]],
      ["a=742%2520Evergreen%2520Terrace&b=1", ["{{street}}", "&b=1"]],
      ["a=742%252BEvergreen%252BTerrace", ["{{street}}"]],
      ["a=742%25252BEvergreen%252520Terrace", ["{{street}}"]],
    ];
    for (const [input, placeholders] of cases) {
      const masked = person(input);
      expect(masked).not.toMatch(/pk1977|Evergreen|Neil/i);
      for (const placeholder of placeholders) expect(masked).toContain(placeholder);
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
