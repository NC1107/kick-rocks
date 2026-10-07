import { describe, expect, it } from "vitest";
import { createMask } from "./mask.js";

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

  it("changes nothing when there is nothing to hide", () => {
    expect(createMask({})("Jordan Example")).toBe("Jordan Example");
  });
});
