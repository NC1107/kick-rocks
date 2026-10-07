import type { Mailbox, MailFolder, ProviderPreset } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  applyPreset,
  connectionBody,
  connectionSignature,
  emptyForm,
  folderChoices,
  formFromMailbox,
  hintForError,
  saveBody,
  setAddress,
  suggestedFolder,
  validateConnection,
  validateSettings,
} from "./connection.js";

const GMAIL: ProviderPreset = {
  id: "gmail",
  label: "Gmail",
  smtpHost: "smtp.gmail.com",
  smtpPort: 465,
  smtpSecure: true,
  imapHost: "imap.gmail.com",
  imapPort: 993,
  appPasswordUrl: "https://myaccount.google.com/apppasswords",
  notes: "",
  defaultDailyCap: 100,
  supported: true,
  unsupportedReason: null,
  authservIds: [],
};

const BRIDGE: ProviderPreset = {
  ...GMAIL,
  id: "proton-bridge",
  label: "Proton Mail Bridge",
  appPasswordUrl: null,
};

function completeForm() {
  return {
    ...applyPreset(emptyForm(), GMAIL),
    address: "riley@example.net",
    username: "riley@example.net",
    password: "app-password",
  };
}

describe("presets and addresses", () => {
  it("fills servers, ports, and the suggested daily limit from a provider", () => {
    const form = applyPreset(emptyForm(), GMAIL);
    expect(form).toMatchObject({
      providerId: "gmail",
      smtpHost: "smtp.gmail.com",
      smtpPort: "465",
      smtpSecure: true,
      imapHost: "imap.gmail.com",
      imapPort: "993",
      dailyCap: "100",
    });
  });

  it("keeps the username in step with the address until the person edits it", () => {
    const typed = setAddress(emptyForm(), " riley@example.net ");
    expect(typed.username).toBe("riley@example.net");
    const edited = { ...typed, username: "riley", usernameEdited: true };
    expect(setAddress(edited, "other@example.net").username).toBe("riley");
  });

  it("treats a saved username that differs from the address as edited", () => {
    const mailbox = {
      id: "m",
      profileId: "p",
      provider: "fastmail",
      address: "jordan@example.com",
      username: "jordan",
      smtpHost: "smtp.fastmail.com",
      smtpPort: 465,
      smtpSecure: true,
      imapHost: "imap.fastmail.com",
      imapPort: 993,
      replyFolder: "Kick Rocks",
      dailyCap: 150,
      lastPolledAt: null,
      lastError: null,
      sendPausedUntil: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    } satisfies Mailbox;
    const form = formFromMailbox(mailbox);
    expect(form.usernameEdited).toBe(true);
    expect(form.password).toBe("");
    expect(form.dailyCap).toBe("150");
  });
});

describe("validateConnection", () => {
  it("accepts a complete form", () => {
    expect(validateConnection(completeForm(), { passwordOptional: false })).toEqual({});
  });

  it("asks for each missing field", () => {
    const errors = validateConnection(emptyForm(), { passwordOptional: false });
    expect(Object.keys(errors).sort()).toEqual(
      ["address", "imapHost", "password", "smtpHost"].sort(),
    );
  });

  it("asks for a username only once the person has cleared it", () => {
    const form = { ...completeForm(), username: "", usernameEdited: true };
    expect(validateConnection(form, { passwordOptional: false }).username).toBe("Required");
  });

  it("lets a saved mailbox keep its stored password", () => {
    const form = { ...completeForm(), password: "" };
    expect(validateConnection(form, { passwordOptional: true })).toEqual({});
    expect(validateConnection(form, { passwordOptional: false }).password).toBe("Required");
  });

  it("rejects a bad address and ports out of range or not numbers", () => {
    const errors = validateConnection(
      { ...completeForm(), address: "nope", smtpPort: "0", imapPort: "99999x" },
      { passwordOptional: false },
    );
    expect(errors.address).toBe("Enter a valid email address");
    expect(errors.smtpPort).toBeDefined();
    expect(errors.imapPort).toBeDefined();
  });
});

describe("validateSettings", () => {
  it("accepts whole numbers from 1 to 2000 and a chosen folder", () => {
    expect(validateSettings({ ...completeForm(), dailyCap: "2000" })).toEqual({});
    expect(validateSettings({ ...completeForm(), dailyCap: "1" })).toEqual({});
  });

  it.each(["0", "2001", "1.5", "", "abc", "-3"])("rejects a daily limit of %j", (dailyCap) => {
    expect(validateSettings({ ...completeForm(), dailyCap }).dailyCap).toBeDefined();
  });

  it("requires a reply folder", () => {
    expect(
      validateSettings({ ...completeForm(), dailyCap: "50", replyFolder: " " }).replyFolder,
    ).toBe("Choose a folder");
  });
});

describe("request bodies", () => {
  it("sends the password only when one was typed", () => {
    expect(connectionBody(completeForm()).password).toBe("app-password");
    expect(connectionBody({ ...completeForm(), password: "" })).not.toHaveProperty("password");
  });

  it("turns port and limit text into numbers and trims the address", () => {
    const body = saveBody({
      ...completeForm(),
      address: " riley@example.net ",
      dailyCap: "80",
      replyFolder: "Kick Rocks",
    });
    expect(body).toMatchObject({
      address: "riley@example.net",
      smtpPort: 465,
      imapPort: 993,
      dailyCap: 80,
      replyFolder: "Kick Rocks",
    });
  });

  it("changes the test signature when anything a test depends on changes", () => {
    const form = completeForm();
    const same = connectionSignature(form);
    expect(connectionSignature({ ...form, dailyCap: "10", replyFolder: "Other" })).toBe(same);
    expect(connectionSignature({ ...form, password: "different" })).not.toBe(same);
    expect(connectionSignature({ ...form, smtpHost: "smtp.example.test" })).not.toBe(same);
    expect(connectionSignature({ ...form, smtpSecure: false })).not.toBe(same);
  });
});

describe("hintForError", () => {
  it("points a rejected sign-in at app passwords when the provider uses them", () => {
    expect(hintForError("535 5.7.8 Username and password not accepted.", GMAIL)).toMatch(
      /app password/,
    );
    expect(hintForError("Login failed: invalid credentials.", BRIDGE)).not.toMatch(/app password/);
  });

  it("tells a person to start Bridge when nothing answers", () => {
    expect(hintForError("connect ECONNREFUSED 127.0.0.1:1025", BRIDGE)).toMatch(/Bridge/);
    expect(hintForError("connect ECONNREFUSED smtp.example.test:465", GMAIL)).toMatch(/port/);
  });

  it("recognizes unknown hosts, timeouts, and certificate problems", () => {
    expect(hintForError("getaddrinfo ENOTFOUND smtp.gmial.com", GMAIL)).toMatch(/typos/);
    expect(hintForError("connect ETIMEDOUT 1.2.3.4:465", GMAIL)).toMatch(/in time/);
    expect(hintForError("self-signed certificate", GMAIL)).toMatch(/secure connection/);
  });

  it("says nothing for an error it does not know, or no error", () => {
    expect(hintForError("something odd", GMAIL)).toBeUndefined();
    expect(hintForError(null, GMAIL)).toBeUndefined();
  });
});

describe("folders", () => {
  const folders: MailFolder[] = [
    { path: "Spam", name: "Spam", specialUse: "\\Junk" },
    { path: "Kick Rocks", name: "Kick Rocks", specialUse: null },
    { path: "INBOX", name: "Inbox", specialUse: "\\Inbox" },
    { path: "Archive/2025", name: "2025", specialUse: null },
  ];

  it("lists the inbox first and shows the path when it differs from the name", () => {
    const choices = folderChoices(folders, "INBOX");
    expect(choices[0]?.path).toBe("INBOX");
    expect(choices.find((choice) => choice.path === "Archive/2025")?.label).toBe(
      "2025 (Archive/2025)",
    );
  });

  it("keeps a saved folder the server no longer lists, and says so", () => {
    const choices = folderChoices(folders, "Gone");
    expect(choices[0]).toEqual({ path: "Gone", label: "Gone (not found on the server)" });
  });

  it("suggests a folder named for Kick Rocks, else the inbox", () => {
    expect(suggestedFolder(folders)).toBe("Kick Rocks");
    expect(suggestedFolder([{ path: "INBOX", name: "Inbox", specialUse: "\\Inbox" }])).toBe(
      "INBOX",
    );
    expect(suggestedFolder([])).toBe("INBOX");
  });
});
