import { API_ROUTES, type Mailbox, type MailFolder, type ProviderPreset } from "@kickrocks/shared";
import { defineMockDomain, handle, MockHttpError, notFound } from "./core.js";
import type { MockStore } from "./store.js";

const SUPPORTED = { supported: true, unsupportedReason: null } as const;

/** What the real presets look like in shape; module B owns the real values. */
const PROVIDERS: ProviderPreset[] = [
  {
    id: "gmail",
    authservIds: [],
    label: "Gmail",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    appPasswordUrl: "https://myaccount.google.com/apppasswords",
    notes:
      "Needs two-step verification on, then an app password. Gmail allows about 500 messages a day.",
    defaultDailyCap: 100,
    ...SUPPORTED,
  },
  {
    id: "google-workspace",
    authservIds: [],
    label: "Google Workspace",
    smtpHost: "smtp.gmail.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.gmail.com",
    imapPort: 993,
    appPasswordUrl: "https://myaccount.google.com/apppasswords",
    notes: "Your administrator must allow app passwords for your account.",
    defaultDailyCap: 100,
    ...SUPPORTED,
  },
  {
    id: "fastmail",
    authservIds: [],
    label: "Fastmail",
    smtpHost: "smtp.fastmail.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.fastmail.com",
    imapPort: 993,
    appPasswordUrl: "https://app.fastmail.com/settings/security/devicekeys",
    notes: "Create an app password with mail access for IMAP and SMTP.",
    defaultDailyCap: 150,
    ...SUPPORTED,
  },
  {
    id: "icloud",
    authservIds: [],
    label: "iCloud Mail",
    smtpHost: "smtp.mail.me.com",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "imap.mail.me.com",
    imapPort: 993,
    appPasswordUrl: "https://account.apple.com/account/manage",
    notes: "Use an app-specific password. Your iCloud address is the username.",
    defaultDailyCap: 100,
    ...SUPPORTED,
  },
  {
    id: "yahoo",
    authservIds: [],
    label: "Yahoo Mail",
    smtpHost: "smtp.mail.yahoo.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.mail.yahoo.com",
    imapPort: 993,
    appPasswordUrl: "https://login.yahoo.com/account/security/app-passwords",
    notes: "Generate an app password for a custom app.",
    defaultDailyCap: 80,
    ...SUPPORTED,
  },
  {
    id: "proton-bridge",
    authservIds: [],
    label: "Proton Mail Bridge",
    smtpHost: "127.0.0.1",
    smtpPort: 1025,
    smtpSecure: false,
    imapHost: "127.0.0.1",
    imapPort: 1143,
    appPasswordUrl: null,
    notes:
      "Bridge must be running on the same machine. Use the bridge password it shows, not your Proton password.",
    defaultDailyCap: 100,
    ...SUPPORTED,
  },
  {
    id: "mailbox-org",
    authservIds: [],
    label: "mailbox.org",
    smtpHost: "smtp.mailbox.org",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.mailbox.org",
    imapPort: 993,
    appPasswordUrl: "https://login.mailbox.org/",
    notes:
      "Turn on two-factor sign-in, then create an app password with access to mail in your account settings.",
    defaultDailyCap: 100,
    ...SUPPORTED,
  },
  {
    id: "zoho",
    authservIds: [],
    label: "Zoho Mail",
    smtpHost: "smtp.zoho.com",
    smtpPort: 465,
    smtpSecure: true,
    imapHost: "imap.zoho.com",
    imapPort: 993,
    appPasswordUrl: "https://accounts.zoho.com/home#security/app_password",
    notes:
      "Enable IMAP access in the mail settings first. Accounts outside the US use a regional host such as zoho.eu.",
    defaultDailyCap: 50,
    ...SUPPORTED,
  },
  {
    id: "other",
    authservIds: [],
    label: "Other provider",
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "",
    imapPort: 993,
    appPasswordUrl: null,
    notes:
      "Enter your provider's SMTP and IMAP hosts. Most providers publish them in their help pages.",
    defaultDailyCap: 50,
    ...SUPPORTED,
  },
  {
    id: "outlook",
    authservIds: [],
    label: "Outlook.com",
    smtpHost: "",
    smtpPort: 587,
    smtpSecure: false,
    imapHost: "",
    imapPort: 993,
    appPasswordUrl: null,
    notes: "",
    defaultDailyCap: 50,
    supported: false,
    unsupportedReason: "Outlook.com needs OAuth sign-in, which Kick Rocks does not support yet.",
  },
];

const FOLDERS: MailFolder[] = [
  { path: "INBOX", name: "Inbox", specialUse: "\\Inbox" },
  { path: "Kick Rocks", name: "Kick Rocks", specialUse: null },
  { path: "Sent", name: "Sent", specialUse: "\\Sent" },
  { path: "Spam", name: "Spam", specialUse: "\\Junk" },
  { path: "Archive", name: "Archive", specialUse: "\\Archive" },
];

function profileOf(store: MockStore, id: string) {
  const profile = store.profiles.find((candidate) => candidate.id === id);
  if (!profile) throw notFound("That profile");
  return profile;
}

export default defineMockDomain({
  name: "mailbox",

  seed(store) {
    const jordan = store.profiles[0];
    if (!jordan) return;
    const mailbox: Mailbox = {
      id: store.nextId("mbx"),
      profileId: jordan.id,
      provider: "fastmail",
      address: "jordan@example.com",
      username: "jordan@example.com",
      smtpHost: "smtp.fastmail.com",
      smtpPort: 465,
      smtpSecure: true,
      imapHost: "imap.fastmail.com",
      imapPort: 993,
      replyFolder: "Kick Rocks",
      dailyCap: 150,
      lastPolledAt: store.ago({ minutes: 6 }),
      lastError: null,
      createdAt: store.ago({ days: 90 }),
    };
    jordan.mailbox = mailbox;
    jordan.mailboxConnected = true;
  },

  routes: (store) => [
    handle(API_ROUTES.mailProviders, () => ({ providers: PROVIDERS })),

    // Each password below fails a different way, so every failure state can be seen:
    // "wrong" fails both, "no-imap" only IMAP, "no-smtp" only SMTP, "refused" and "slow" fail both
    // with a network error, and "boom" answers 500.
    handle(API_ROUTES.mailboxTest, ({ params, body }) => {
      profileOf(store, params.id);
      if (body.password === "boom") {
        throw new MockHttpError(
          500,
          "internal",
          "The server hit a problem. Try again in a moment.",
        );
      }
      const refused = body.password === "refused";
      const network = refused || body.password === "slow";
      const reason = refused ? "ECONNREFUSED" : "ETIMEDOUT";
      const smtpFails = body.password === "wrong" || body.password === "no-smtp" || network;
      const imapFails = body.password === "wrong" || body.password === "no-imap" || network;
      return {
        smtp: {
          ok: !smtpFails,
          error: network
            ? `connect ${reason} ${body.smtpHost}:${body.smtpPort}`
            : smtpFails
              ? "535 5.7.8 Username and password not accepted."
              : null,
        },
        imap: {
          ok: !imapFails,
          error: network
            ? `connect ${reason} ${body.imapHost}:${body.imapPort}`
            : imapFails
              ? "Login failed: invalid credentials."
              : null,
          folders: imapFails ? [] : FOLDERS,
        },
      };
    }),

    handle(API_ROUTES.mailboxSave, ({ params, body }) => {
      const profile = profileOf(store, params.id);
      if (!(body.password || profile.mailbox)) {
        throw new MockHttpError(
          400,
          "invalid_request",
          "A password is required for a new mailbox.",
          [{ path: ["password"], message: "Enter the app password" }],
        );
      }
      const { password: _password, ...fields } = body;
      const mailbox: Mailbox = {
        id: profile.mailbox?.id ?? store.nextId("mbx"),
        profileId: profile.id,
        ...fields,
        lastPolledAt: profile.mailbox?.lastPolledAt ?? null,
        lastError: null,
        createdAt: profile.mailbox?.createdAt ?? store.clock.now().toISOString(),
      };
      profile.mailbox = mailbox;
      profile.mailboxConnected = true;
      return mailbox;
    }),

    handle(API_ROUTES.mailboxDelete, ({ params }) => {
      const profile = profileOf(store, params.id);
      profile.mailbox = null;
      profile.mailboxConnected = false;
      return { ok: true as const };
    }),

    handle(API_ROUTES.mailboxPoll, ({ params }) => {
      const profile = profileOf(store, params.id);
      if (!profile.mailbox) throw new MockHttpError(409, "conflict", "Connect a mailbox first.");
      profile.mailbox.lastPolledAt = store.clock.now().toISOString();
      const now = store.clock.now().toISOString();
      return {
        task: {
          id: store.nextId("tsk"),
          kind: "inbox_poll" as const,
          status: "queued" as const,
          priority: 0,
          profileId: profile.id,
          targetId: null,
          targetName: null,
          requestId: null,
          blockedReason: null,
          blockedDetail: null,
          blockedUrl: null,
          attempts: 0,
          maxAttempts: 3,
          lastError: null,
          failureKind: null,
          failureStep: null,
          hasScreenshot: false,
          finishedBy: null,
          claimerKind: null,
          usage: null,
          createdAt: now,
          updatedAt: now,
        },
      };
    }),

    handle(API_ROUTES.mailboxFolders, ({ params }) => {
      const profile = profileOf(store, params.id);
      if (!profile.mailbox) throw new MockHttpError(409, "conflict", "Connect a mailbox first.");
      return { folders: FOLDERS };
    }),
  ],
});
