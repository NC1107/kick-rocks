import { describe, expect, it } from "vitest";
import { createMask, restoreFields } from "./mask.js";

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

  it("restores a value where a placeholder stands, and leaves other placeholders alone", () => {
    expect(
      restoreFields("{{first_name}} {{last_name}} {{zip}} {{nope}}", {
        first_name: "Jordan",
        last_name: "Example",
      }),
    ).toBe("Jordan Example {{zip}} {{nope}}");
  });

  it("changes nothing when there is nothing to hide", () => {
    expect(createMask({})("Jordan Example")).toBe("Jordan Example");
  });
});
