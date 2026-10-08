import { describe, expect, it } from "vitest";
import { provesNeverSent, transportOptions } from "./transport.js";
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

describe("provesNeverSent for the errors nodemailer raises while connecting", () => {
  const connectError = (reason: string) =>
    Object.assign(new Error(`connect ${reason} 192.0.2.1:587`), {
      code: "ESOCKET",
      command: "CONN",
      syscall: "connect",
    });

  it.each(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"])("accepts %s", (reason) => {
    expect(provesNeverSent(connectError(reason))).toBe(true);
  });

  it("does not trust ESOCKET alone, which nodemailer also uses after DATA", () => {
    const afterData = Object.assign(new Error("read ECONNRESET"), {
      code: "ESOCKET",
      command: "DATA",
    });
    expect(provesNeverSent(afterData)).toBe(false);
  });
});
