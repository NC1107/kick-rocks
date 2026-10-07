import { describe, expect, it } from "vitest";
import { senderIsAuthenticated } from "./sender-auth.js";
import type { InboxMessage } from "./types.js";

function messageWith(
  authenticationResults: string[],
  authenticationReceivedAbove?: number[],
): InboxMessage {
  return {
    uid: 1,
    messageId: null,
    inReplyTo: null,
    references: [],
    from: { name: null, address: "privacy@acme.test" },
    to: [],
    subject: "",
    date: null,
    text: "",
    html: null,
    isBounce: false,
    autoSubmitted: false,
    headers: {},
    authenticationResults,
    ...(authenticationReceivedAbove ? { authenticationReceivedAbove } : {}),
  };
}

const authenticated = (headers: string[], received?: number[], trusted = ["mx.google.com"]) =>
  senderIsAuthenticated(messageWith(headers, received), ["acme.test"], trusted);

describe("senderIsAuthenticated", () => {
  describe("with sender text echoed by the provider", () => {
    const echo = (inner: string) =>
      `mx.google.com; spf=softfail (google.com: domain of "x${inner}dkim=pass header.d=acme.test"@evil.test does not designate 1.2.3.4 as permitted sender) smtp.mailfrom="x${inner}dkim=pass header.d=acme.test"@evil.test; dmarc=fail header.from=acme.test`;

    it("does not read a pass out of a semicolon inside a comment and a quoted local part", () => {
      expect(authenticated([echo("; ")])).toBe(false);
    });

    it("does not read a pass out of spaces inside a comment and a quoted local part", () => {
      expect(authenticated([echo("  ")])).toBe(false);
    });

    it("does not read a pass out of a nested comment", () => {
      expect(
        authenticated(["mx.google.com; spf=fail (a (b; dkim=pass header.d=acme.test) c) x=y"]),
      ).toBe(false);
    });

    it("does not read a pass out of a reason string", () => {
      expect(
        authenticated(['mx.google.com; dkim=fail reason="; dkim=pass header.d=acme.test"']),
      ).toBe(false);
    });

    it("does not trust a header whose comment or quote never closes", () => {
      expect(authenticated(["mx.google.com; dkim=pass header.d=acme.test (open"])).toBe(false);
      expect(authenticated(['mx.google.com; dkim=pass header.d=acme.test x="open'])).toBe(false);
    });

    it("takes a method result only as the first token of a section", () => {
      expect(authenticated(["mx.google.com; spf=fail dkim=pass header.d=acme.test"])).toBe(false);
    });

    it("reads a property only as a ptype.property token, not inside a longer value", () => {
      expect(authenticated(["mx.google.com; dkim=pass x.y=header.d=acme.test"])).toBe(false);
    });
  });

  describe("with headers a real provider writes", () => {
    it("accepts a Gmail style header", () => {
      expect(
        authenticated([
          "mx.google.com; dkim=pass header.i=@acme.test header.s=s1 header.b=AbCd; spf=pass (google.com: domain of privacy@acme.test designates 203.0.113.9 as permitted sender) smtp.mailfrom=privacy@acme.test; dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=acme.test",
        ]),
      ).toBe(true);
    });

    it("accepts a Fastmail style header with a dkim domain and a comment", () => {
      expect(
        authenticated(
          [
            "mx1.messagingengine.com; dkim=pass (2048-bit rsa key sha256) header.d=mail.acme.test header.i=@mail.acme.test header.b=xyz; x-me-sender=none",
          ],
          undefined,
          ["messagingengine.com"],
        ),
      ).toBe(true);
    });

    it("accepts an iCloud style header per method, in one run", () => {
      expect(
        authenticated(
          [
            "dmarc.icloud.com; dmarc=none header.from=other.test",
            "dkim-verifier.icloud.com; dkim=pass (2048-bit key) header.d=acme.test header.i=@acme.test",
            "spf.icloud.com; spf=pass (spf.icloud.com: domain of privacy@acme.test designates 203.0.113.9 as permitted sender) smtp.mailfrom=privacy@acme.test",
          ],
          [0, 0, 0],
          ["icloud.com"],
        ),
      ).toBe(true);
    });

    it("accepts a header with a quoted header.from mailbox", () => {
      expect(authenticated(['mx.google.com; dmarc=pass header.from="privacy"@acme.test'])).toBe(
        true,
      );
    });

    it("accepts a version number after the authserv-id", () => {
      expect(authenticated(["mx.google.com 1; dkim=pass header.d=acme.test"])).toBe(true);
    });
  });

  describe("which headers are one run", () => {
    const pass = "mx.google.com; dkim=pass header.d=acme.test";

    it("stops at a Received header, so a copy below a hop is the sender's", () => {
      expect(authenticated(["mx.google.com; dkim=fail header.d=acme.test", pass], [0, 1])).toBe(
        false,
      );
    });

    it("stops at a header under another authserv-id", () => {
      expect(
        authenticated(
          ["mx.google.com; dkim=fail header.d=acme.test", "mail.evil.test; dkim=none", pass],
          [0, 0, 0],
        ),
      ).toBe(false);
    });

    it("starts at the first trusted header even when a foreign one sits above it", () => {
      expect(authenticated(["mail.evil.test; dkim=pass header.d=acme.test", pass], [0, 0])).toBe(
        true,
      );
    });

    it("reads headers written one per method", () => {
      expect(authenticated(["mx.google.com; spf=pass smtp.mailfrom=a@b.test", pass], [0, 0])).toBe(
        true,
      );
    });
  });
});
