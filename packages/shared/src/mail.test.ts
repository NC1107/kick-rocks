import { describe, expect, it } from "vitest";
import {
  formatReference,
  generateReference,
  MailboxInput,
  outgoingMessageId,
  parseOutgoingMessageId,
  parseReferences,
  Reference,
} from "./mail.js";

describe("formatReference", () => {
  it("prefixes and uppercases a code", () => {
    expect(formatReference("7xk2m9")).toBe("KR-7XK2M9");
  });

  it("maps look-alike characters to their Crockford digits", () => {
    expect(formatReference("O1lI0o")).toBe("KR-011100");
  });

  it("rejects codes of the wrong length or alphabet", () => {
    expect(() => formatReference("ABC")).toThrow();
    expect(() => formatReference("ABCDEFG")).toThrow();
    expect(() => formatReference("ABCDEU")).toThrow();
    expect(() => formatReference("ABC-EF")).toThrow();
  });
});

describe("generateReference", () => {
  it("produces valid references", () => {
    for (let i = 0; i < 200; i++)
      expect(Reference.safeParse(generateReference()).success).toBe(true);
  });

  it("is deterministic given the same bytes", () => {
    expect(generateReference(() => Uint8Array.from([0, 1, 2, 31, 32, 255]))).toBe("KR-012Z0Z");
  });

  it("uses all 32 characters evenly", () => {
    const seen = new Set<string>();
    for (let b = 0; b < 32; b++) seen.add(generateReference(() => new Uint8Array(6).fill(b)));
    expect(seen.size).toBe(32);
  });
});

describe("parseReferences", () => {
  it("finds a reference in a subject", () => {
    expect(parseReferences("Re: Opt-out request KR-7XK2M9")).toEqual(["KR-7XK2M9"]);
  });

  it("is case insensitive and normalizes look-alikes", () => {
    expect(parseReferences("kr-7xk2m9 and Kr-OIl0Oo")).toEqual(["KR-7XK2M9", "KR-011000"]);
  });

  it("returns each reference once, in order", () => {
    expect(parseReferences("KR-AAAAAA then KR-BBBBBB then KR-AAAAAA")).toEqual([
      "KR-AAAAAA",
      "KR-BBBBBB",
    ]);
  });

  it("finds references wrapped in punctuation", () => {
    expect(parseReferences("[KR-7XK2M9] (KR-ABCDEF), KR-123456.")).toEqual([
      "KR-7XK2M9",
      "KR-ABCDEF",
      "KR-123456",
    ]);
  });

  it("ignores near misses", () => {
    expect(parseReferences("KR-7XK2M")).toEqual([]);
    expect(parseReferences("KR-7XK2M99")).toEqual([]);
    expect(parseReferences("XKR-7XK2M9")).toEqual([]);
    expect(parseReferences("KR-7XK2MU")).toEqual([]);
    expect(parseReferences("no reference here")).toEqual([]);
  });
});

describe("outgoing message ids", () => {
  const requestId = "0b9f3c7e-1d2a-4c55-9a0b-1234567890ab";

  it("round-trips", () => {
    const id = outgoingMessageId(requestId, "mail.example.com", 2);
    expect(id).toBe(`<kr.${requestId}.2@mail.example.com>`);
    expect(parseOutgoingMessageId(id)).toEqual({
      requestId,
      sequence: 2,
      domain: "mail.example.com",
    });
  });

  it("defaults the sequence to zero", () => {
    expect(parseOutgoingMessageId(outgoingMessageId(requestId, "example.com"))?.sequence).toBe(0);
  });

  it("gives follow-ups distinct ids", () => {
    expect(outgoingMessageId(requestId, "example.com", 0)).not.toBe(
      outgoingMessageId(requestId, "example.com", 1),
    );
  });

  it("parses without angle brackets", () => {
    expect(parseOutgoingMessageId(`kr.${requestId}.0@example.com`)?.requestId).toBe(requestId);
  });

  it("returns null for ids we did not make", () => {
    expect(parseOutgoingMessageId("<abc123@mail.gmail.com>")).toBeNull();
    expect(parseOutgoingMessageId("<kr.@example.com>")).toBeNull();
    expect(parseOutgoingMessageId("<kr.abc.x@example.com>")).toBeNull();
    expect(parseOutgoingMessageId("")).toBeNull();
  });

  it("refuses to build an id that could not be parsed back", () => {
    expect(() => outgoingMessageId("has.dot", "example.com")).toThrow();
    expect(() => outgoingMessageId("a b", "example.com")).toThrow();
    expect(() => outgoingMessageId(requestId, "bad domain")).toThrow();
    expect(() => outgoingMessageId(requestId, "example.com", -1)).toThrow();
    expect(() => outgoingMessageId(requestId, "example.com", 1.5)).toThrow();
  });
});

describe("MailboxInput", () => {
  const input = {
    provider: "fastmail",
    address: "jordan@example.com",
    username: "jordan@example.com",
    smtpHost: "smtp.example.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.example.com",
    imapPort: 993,
    dailyCap: 50,
  };

  it("defaults the reply folder and makes the password optional", () => {
    expect(MailboxInput.parse(input)).toMatchObject({ replyFolder: "INBOX" });
    expect(MailboxInput.safeParse({ ...input, password: "app-password" }).success).toBe(true);
  });

  it("bounds the daily cap", () => {
    expect(MailboxInput.safeParse({ ...input, dailyCap: 0 }).success).toBe(false);
    expect(MailboxInput.safeParse({ ...input, dailyCap: 5000 }).success).toBe(false);
  });
});
