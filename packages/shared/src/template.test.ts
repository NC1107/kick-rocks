import { describe, expect, it } from "vitest";
import { renderTemplate, TemplateError, templateFields } from "./template.js";

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
    expect(() => renderTemplate("{{city|slug|lower}}", fields)).toThrow(/Malformed/);
  });
});

describe("templateFields", () => {
  it("lists distinct field names in order", () => {
    expect(templateFields("{{b}}/{{a|slug}}/{{b|lower}}")).toEqual(["b", "a"]);
    expect(templateFields("no placeholders")).toEqual([]);
  });
});
