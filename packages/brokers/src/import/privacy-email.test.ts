import { describe, expect, it } from "vitest";
import { usablePrivacyEmail } from "./privacy-email.js";

const own = ["acme.example"];

describe("usablePrivacyEmail", () => {
  it.each([
    "privacy@acme.example",
    "Privacy@Acme.example",
    "legal@acme.example",
    "dpo@acme.example",
    "dsar@acme.example",
    "ca_drop_acme@acme.example",
    "info@acme.example",
    "privacy+california@acme.example",
    "privacy@mail.acme.example",
  ])("keeps %s", (email) => {
    expect(usablePrivacyEmail(email, own)).toBe(email);
  });

  it.each([
    "accounting@acme.example",
    "security@acme.example",
    "tax@acme.example",
    "finance@acme.example",
    "infosec@acme.example",
    "operations@acme.example",
    "jane.doe@acme.example",
    "blakehogan@acme.example",
  ])("drops %s because it is not a privacy inbox", (email) => {
    expect(usablePrivacyEmail(email, own)).toBeNull();
  });

  it("drops a privacy inbox on a host that is not the broker's own", () => {
    expect(usablePrivacyEmail("privacy@other.example", own)).toBeNull();
    expect(usablePrivacyEmail("privacy@notacme.example", own)).toBeNull();
  });

  it("takes the first usable address of several", () => {
    expect(usablePrivacyEmail("jane@acme.example; privacy@acme.example", own)).toBe(
      "privacy@acme.example",
    );
  });

  it("returns null for text that is not an address", () => {
    expect(usablePrivacyEmail("see our website", own)).toBeNull();
    expect(usablePrivacyEmail("", own)).toBeNull();
  });
});
