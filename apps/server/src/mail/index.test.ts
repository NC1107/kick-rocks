import { outgoingMessageId } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { noDkim, signedAs } from "../test-utils/dkim.js";
import { createMailServices } from "./index.js";

const connection = {
  address: "jordan@example.com",
  username: "jordan@example.com",
  password: "app-password",
  smtpHost: "smtp.example.test",
  smtpPort: 587,
  smtpSecure: false,
  imapHost: "imap.example.test",
  imapPort: 993,
};

describe("createMailServices", () => {
  it("builds a transport and an inbox for each connection", () => {
    const mail = createMailServices(loadConfig({}), { get: () => null } as never);
    expect(Object.keys(mail.transport(connection)).sort()).toEqual(["send", "verify"]);
    expect(Object.keys(mail.inbox(connection)).sort()).toEqual(["fetchSince", "listFolders"]);
  });

  it("gives the link follower the configured private hosts", async () => {
    const mail = createMailServices(
      loadConfig({ KICKROCKS_ALLOW_PRIVATE_LINK_HOSTS: "broker.test" }),
      { get: () => null } as never,
      {
        resolve: async () => [{ address: "127.0.0.1", family: 4 }],
      },
    );
    // Allowed to resolve privately, so the failure is the connection, not the address check. Loopback refuses at once; a LAN address would wait for a connect timeout on a runner with no such host.
    const allowed = await mail.linkFollower.follow("http://broker.test:1/x", ["broker.test"]);
    expect(allowed.reason).not.toMatch(/private/);

    const refused = await mail.linkFollower.follow("http://other.test/x", ["other.test"]);
    expect(refused.reason).toMatch(/private or local/);
  });

  it("reads the language model setting when each message is classified", async () => {
    let reads = 0;
    const mail = createMailServices(loadConfig({}), {
      get: () => {
        reads += 1;
        return null;
      },
    } as never);
    const message = {
      uid: 1,
      messageId: null,
      inReplyTo: null,
      references: [],
      from: { name: null, address: "x@else.test" },
      to: [],
      subject: "Hello",
      date: null,
      text: "Hmm",
      html: null,
      isBounce: false,
      autoSubmitted: false,
      headers: {},
      verifyDkim: noDkim,
    };
    await mail.classifier.classify(message, { requests: [] });
    expect(reads).toBe(0);
    const sent = outgoingMessageId("req-1", "example.com");
    await mail.classifier.classify(
      {
        ...message,
        inReplyTo: sent,
        from: { name: null, address: "privacy@acme.test" },
        verifyDkim: signedAs("acme.test", { inReplyTo: [sent] }),
      },
      {
        requests: [
          {
            id: "req-1",
            reference: "KR-7K3M9Q",
            outgoingMessageId: sent,
            status: "awaiting_reply",
            channel: "email",
            targetId: "acme",
            targetName: "Acme Data",
            targetDomain: "acme.test",
            replyDomains: ["acme.test"],
            curatedReplyDomains: [],
            replyAddresses: [],
            recordUrl: null,
            awaitingConfirmation: null,
          },
        ],
      },
    );
    expect(reads).toBe(1);
  });
});
