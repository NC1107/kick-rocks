import { describe } from "vitest";
import { FakeClock } from "../test-utils/clock.js";
import { createFakeMail } from "../test-utils/fake-mail.js";
import { defineInboxContract } from "../test-utils/inbox-contract.js";

describe("the scripted inbox keeps the inbox contract", () => {
  defineInboxContract(() => {
    const fake = createFakeMail(new FakeClock());
    const connection = {
      address: "jordan@example.com",
      username: "jordan@example.com",
      password: "fake",
      smtpHost: "smtp.example.test",
      smtpPort: 587,
      smtpSecure: false,
      imapHost: "imap.example.test",
      imapPort: 993,
    };
    const mailbox = fake.mailbox(connection.address);
    return {
      source: fake.services.inbox(connection),
      deliver: async ({ subject, text, from = "privacy@broker.test", headers = [] }) => {
        const address = from.match(/<([^>]+)>/)?.[1] ?? from;
        mailbox.deliver({
          subject,
          text,
          from: { name: null, address },
          headers: Object.fromEntries(
            headers.map((line) => {
              const [name, ...value] = line.split(":");
              return [(name ?? "").toLowerCase(), value.join(":").trim()];
            }),
          ),
        });
      },
      settle: async () => {},
    };
  });
});
