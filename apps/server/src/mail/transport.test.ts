import { describe, expect, it } from "vitest";
import { transportOptions } from "./transport.js";
import type { MailConnection } from "./types.js";

const connection = (smtpHost: string): MailConnection => ({
  address: "jordan@example.com",
  username: "jordan@example.com",
  password: "app-password",
  smtpHost,
  smtpPort: 587,
  smtpSecure: false,
  imapHost: smtpHost,
  imapPort: 143,
});

describe("transportOptions", () => {
  it("requires STARTTLS for a host that is not this machine, so a password never crosses in the clear", () => {
    expect(transportOptions(connection("smtp.example.com")).requireTLS).toBe(true);
    expect(transportOptions(connection("greenmail")).requireTLS).toBe(true);
  });

  it("allows plain SMTP to this machine and to a host the operator named", () => {
    expect(transportOptions(connection("localhost")).requireTLS).toBe(false);
    expect(
      transportOptions(connection("greenmail"), { plaintextHosts: ["greenmail"] }).requireTLS,
    ).toBe(false);
    expect(
      transportOptions(connection("smtp.example.com"), { plaintextHosts: ["greenmail"] })
        .requireTLS,
    ).toBe(true);
  });
});
