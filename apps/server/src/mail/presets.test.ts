import { ProviderPreset } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { findProviderPreset, PROVIDER_PRESETS } from "./presets.js";

describe("provider presets", () => {
  it("are all valid against the shared schema", () => {
    for (const preset of PROVIDER_PRESETS) expect(() => ProviderPreset.parse(preset)).not.toThrow();
  });

  it("cover the providers the plan names, plus Other and unsupported Outlook.com", () => {
    expect(PROVIDER_PRESETS.map((preset) => preset.id)).toEqual([
      "gmail",
      "google-workspace",
      "fastmail",
      "icloud",
      "yahoo",
      "proton-bridge",
      "mailbox-org",
      "zoho",
      "other",
      "outlook",
    ]);
  });

  it("name the authserv-ids of every real provider, and none for the ones with unknown mail servers", () => {
    for (const preset of PROVIDER_PRESETS) {
      const known = preset.supported && preset.id !== "other";
      expect(preset.authservIds.length > 0).toBe(known);
    }
    expect(findProviderPreset("gmail")?.authservIds).toContain("mx.google.com");
  });

  it("have unique ids", () => {
    const ids = PROVIDER_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("give every supported provider with fixed hosts an app password link or a reason it has none", () => {
    for (const preset of PROVIDER_PRESETS.filter((p) => p.supported && p.smtpHost)) {
      expect(preset.notes.length).toBeGreaterThan(20);
      if (preset.id !== "proton-bridge") expect(preset.appPasswordUrl).toMatch(/^https:\/\//);
    }
  });

  it("only mark a provider unsupported with a reason, and never otherwise", () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(preset.supported).toBe(preset.unsupportedReason === null);
    }
    expect(findProviderPreset("outlook")).toMatchObject({ supported: false });
    expect(findProviderPreset("outlook")?.unsupportedReason).toMatch(/OAuth/);
  });

  it("use TLS from the start on port 465 and STARTTLS elsewhere, and 993 for IMAP over TLS", () => {
    for (const preset of PROVIDER_PRESETS.filter((p) => p.smtpHost && p.id !== "proton-bridge")) {
      expect(preset.smtpSecure).toBe(preset.smtpPort === 465);
      expect(preset.imapPort).toBe(993);
    }
  });

  it("keep default caps well under the limits the notes mention", () => {
    expect(findProviderPreset("gmail")?.defaultDailyCap).toBeLessThanOrEqual(150);
    expect(findProviderPreset("yahoo")?.defaultDailyCap).toBeLessThanOrEqual(100);
  });

  it("finds a preset by id and answers null for an unknown one", () => {
    expect(findProviderPreset("fastmail")?.imapHost).toBe("imap.fastmail.com");
    expect(findProviderPreset("nope")).toBeNull();
  });

  it("contains no em dash", () => {
    expect(JSON.stringify(PROVIDER_PRESETS)).not.toContain("\u2014");
  });
});
