import { describe, expect, it } from "vitest";
import { renderTemplate, TemplateError, templateFields, templateProblem } from "./template.js";

const fields = {
  first_name: "Mary Ann",
  last_name: "O'Brien-Smith",
  city: "São Paulo",
  email: "jordan+kr@example.com",
};

describe("renderTemplate", () => {
  it("substitutes plain fields", () => {
    expect(renderTemplate("{{first_name}} {{last_name}}", fields)).toBe("Mary Ann O'Brien-Smith");
  });

  it("applies the slug filter", () => {
    expect(renderTemplate("https://site.test/{{first_name|slug}}-{{last_name|slug}}", fields)).toBe(
      "https://site.test/mary-ann-o-brien-smith",
    );
    expect(renderTemplate("{{city|slug}}", fields)).toBe("sao-paulo");
  });

  it("applies the lower filter", () => {
    expect(renderTemplate("{{last_name|lower}}", fields)).toBe("o'brien-smith");
  });

  it("applies the urlencode filter", () => {
    expect(renderTemplate("https://site.test/?e={{email|urlencode}}", fields)).toBe(
      "https://site.test/?e=jordan%2Bkr%40example.com",
    );
  });

  it("tolerates whitespace inside the braces", () => {
    expect(renderTemplate("{{ first_name | lower }}", fields)).toBe("mary ann");
  });

  it("returns templates without placeholders unchanged", () => {
    expect(renderTemplate("https://site.test/optout", {})).toBe("https://site.test/optout");
  });

  it("renders a repeated field each time", () => {
    expect(renderTemplate("{{city}}/{{city|lower}}", { city: "Austin" })).toBe("Austin/austin");
  });

  it("does not re-expand placeholders inside values", () => {
    expect(renderTemplate("{{first_name}}", { first_name: "{{last_name}}" })).toBe("{{last_name}}");
  });

  it("throws on an unknown field", () => {
    expect(() => renderTemplate("{{nope}}", fields)).toThrow(TemplateError);
    expect(() => renderTemplate("{{nope}}", fields)).toThrow(/Unknown template field "nope"/);
  });

  it("throws when a declared field has no value", () => {
    expect(() => renderTemplate("{{phone}}", { first_name: "A" })).toThrow(/"phone"/);
  });

  it("throws on an unknown filter", () => {
    expect(() => renderTemplate("{{city|shout}}", fields)).toThrow(
      /Unknown template filter "shout"/,
    );
  });

  it("throws on malformed placeholders", () => {
    expect(() => renderTemplate("{{city", fields)).toThrow(/Malformed/);
    expect(() => renderTemplate("city}}", fields)).toThrow(/Malformed/);
    expect(() => renderTemplate("{{CITY}}", fields)).toThrow(/Malformed/);
    expect(() => renderTemplate("{{city|slug|}}", fields)).toThrow(/Malformed/);
  });
});

describe("templateFields", () => {
  it("lists distinct field names in order", () => {
    expect(templateFields("{{b}}/{{a|slug}}/{{b|lower}}")).toEqual(["b", "a"]);
    expect(templateFields("no placeholders")).toEqual([]);
  });
});

describe("state_name", () => {
  it("turns a state code into the name a dropdown shows", () => {
    expect(renderTemplate("{{state|state_name}}", { state: "TX" })).toBe("Texas");
    expect(renderTemplate("{{state|state_name}}", { state: "dc" })).toBe("District of Columbia");
  });

  it("throws on something that is not a state code", () => {
    expect(() => renderTemplate("{{state|state_name}}", { state: "Texas" })).toThrow(
      /not a state code/,
    );
  });
});

describe("chained filters", () => {
  it("applies filters left to right", () => {
    expect(renderTemplate("{{state|state_name|slug}}", { state: "NY" })).toBe("new-york");
    expect(renderTemplate("{{state|state_name|slug}}", { state: "tx" })).toBe("texas");
    expect(renderTemplate("{{state|state_name|slug}}", { state: "DC" })).toBe(
      "district-of-columbia",
    );
  });

  it("makes the order matter", () => {
    expect(renderTemplate("{{city|lower|urlencode}}", { city: "ST LOUIS" })).toBe("st%20louis");
    expect(renderTemplate("{{city|urlencode|lower}}", { city: "ST LOUIS" })).toBe("st%20louis");
    expect(renderTemplate("{{city|urlencode|slug}}", { city: "ST LOUIS" })).toBe("st-20louis");
  });

  it("tolerates whitespace around each filter", () => {
    expect(renderTemplate("{{ state | state_name | slug }}", { state: "NM" })).toBe("new-mexico");
  });

  it("fails when any filter in the chain is unknown or fails", () => {
    expect(() => renderTemplate("{{state|state_name|shout}}", { state: "TX" })).toThrow(
      /Unknown template filter "shout"/,
    );
    expect(() => renderTemplate("{{state|state_name|state_name}}", { state: "TX" })).toThrow(
      /not a state code/,
    );
  });

  it("reports an unknown filter anywhere in a chain without values", () => {
    expect(templateProblem("{{state|state_name|shout}}")).toMatch(
      /Unknown template filter "shout"/,
    );
    expect(templateProblem("{{state|state_name|slug}}")).toBeNull();
  });

  it("lists the field once for a chain", () => {
    expect(templateFields("{{state|state_name|slug}}")).toEqual(["state"]);
  });
});

describe("templateProblem", () => {
  it("is null for a well formed template", () => {
    expect(templateProblem("https://x.test/{{first_name|slug}}/{{state|state_name}}")).toBeNull();
    expect(templateProblem("no placeholders")).toBeNull();
  });

  it("names a malformed placeholder or an unknown filter without needing any values", () => {
    expect(templateProblem("{{city")).toMatch(/Malformed/);
    expect(templateProblem("{{city|shout}}")).toMatch(/Unknown template filter "shout"/);
  });
});
