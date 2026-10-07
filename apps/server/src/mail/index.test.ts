import { NotImplementedError } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";
import { createMailServices } from "./index.js";

const mail = createMailServices(loadConfig({}), {} as never);
const connection = {
  address: "jordan@example.com",
  username: "jordan@example.com",
  password: "app-password",
  smtpHost: "smtp.example.com",
  smtpPort: 587,
  smtpSecure: false,
  imapHost: "imap.example.com",
  imapPort: 993,
};

describe("createMailServices stub", () => {
  it("rejects every call with NotImplementedError", async () => {
    await expect(mail.transport(connection).verify()).rejects.toThrow(NotImplementedError);
    await expect(mail.transport(connection).send({} as never)).rejects.toThrow(NotImplementedError);
    await expect(mail.inbox(connection).listFolders()).rejects.toThrow(NotImplementedError);
    await expect(
      mail.inbox(connection).fetchSince("INBOX", null, null, { since: null, limit: 10 }),
    ).rejects.toThrow(/InboxSource.fetchSince is not implemented yet/);
    await expect(mail.classifier.classify({} as never, { requests: [] })).rejects.toThrow(
      NotImplementedError,
    );
    await expect(mail.linkFollower.follow("https://example.com", [])).rejects.toThrow(
      NotImplementedError,
    );
  });
});
