import {
  API_ROUTES,
  type Mailbox,
  type MailboxPoll,
  type MailFolder,
  type ProviderPreset,
} from "@kickrocks/shared";
import { defineMockDomain, handle, MockHttpError, notFound } from "./core.js";
import type { MockStore } from "./store.js";

const SUPPORTED = { supported: true, unsupportedReason: null } as const;

/** What the real presets look like in shape; module B owns the real values. */
const PROVIDERS: ProviderPreset[] = [
  {
    id: "gmail",
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
    unsupportedReason:
      "Outlook.com, Hotmail, and Live accept IMAP and SMTP sign-in only through OAuth, which is not supported yet. Use another mailbox for now.",
  },
];

const FOLDERS: MailFolder[] = [
  { path: "INBOX", name: "Inbox", specialUse: "\\Inbox" },
  { path: "Kick Rocks", name: "Kick Rocks", specialUse: null },
  { path: "Sent", name: "Sent", specialUse: "\\Sent" },
  { path: "Spam", name: "Spam", specialUse: "\\Junk" },
  { path: "Archive", name: "Archive", specialUse: "\\Archive" },
];

const MANUAL_POLL_GAP_MS = 30_000;
const MOCK_POLL_RUNS_MS = 1_800;

/**
 * A check the mock fakes: it waits, then ends. Every other check finds one reply for the first
 * request that waits on an answer, and a mailbox whose folder is named "Broken" fails, so the
 * page can be seen in each of its outcomes.
 */
interface MockPoll {
  id: string;
  profileId: string;
  startedAt: number;
  createdAt: string;
  reply: boolean;
}

function pollIsFinished(store: MockStore, poll: MockPoll): boolean {
  return store.clock.now().getTime() - poll.startedAt >= MOCK_POLL_RUNS_MS;
}

function describePoll(store: MockStore, poll: MockPoll): MailboxPoll {
  const profile = profileOf(store, poll.profileId);
  const finished = pollIsFinished(store, poll);
  const broken = profile.mailbox?.replyFolder === "Broken";
  const status = !finished ? ("leased" as const) : broken ? ("failed" as const) : ("done" as const);
  const updatedAt = finished
    ? new Date(poll.startedAt + MOCK_POLL_RUNS_MS).toISOString()
    : poll.createdAt;
  if (finished && profile.mailbox) profile.mailbox.lastPolledAt = updatedAt;
  const waiting = store.requests.find(
    (request) =>
      request.profileId === profile.id &&
      (request.status === "awaiting_reply" || request.status === "sent"),
  );
  const matched = poll.reply && waiting ? [waiting.id] : [];
  const error = "IMAP login failed. Check the app password.";
  return {
    task: {
      id: poll.id,
      kind: "inbox_poll",
      status,
      priority: 0,
      profileId: profile.id,
      targetId: null,
      targetName: null,
      requestId: null,
      blockedReason: null,
      blockedDetail: null,
      blockedUrl: null,
      attempts: finished ? 1 : 0,
      maxAttempts: 3,
      lastError: status === "failed" ? error : null,
      failureKind: status === "failed" ? "network" : null,
      failureStep: null,
      hasScreenshot: false,
      finishedBy: null,
      claimerKind: null,
      usage: null,
      createdAt: poll.createdAt,
      updatedAt,
    },
    outcome: !finished
      ? null
      : broken
        ? { state: "failed", error }
        : {
            state: "done",
            newMessages: matched.length,
            matched: matched.length,
            needsReview: 0,
            matchedRequestIds: matched,
          },
  };
}

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
      sendPausedUntil: null,
      createdAt: store.ago({ days: 90 }),
    };
    jordan.mailbox = mailbox;
    jordan.mailboxConnected = true;
  },

  routes: (store) => {
    const polls = new Map<string, MockPoll>();
    return [
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
          sendPausedUntil: null,
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
        const mailbox = profile.mailbox;
        if (!mailbox) throw new MockHttpError(409, "conflict", "Connect a mailbox first.");
        const running = [...polls.values()].find(
          (poll) => poll.profileId === profile.id && !pollIsFinished(store, poll),
        );
        if (running) return describePoll(store, running);

        const now = store.clock.now().getTime();
        const since = mailbox.lastPolledAt ? now - Date.parse(mailbox.lastPolledAt) : Infinity;
        if (since >= 0 && since < MANUAL_POLL_GAP_MS) {
          const ago = Math.max(1, Math.ceil(since / 1000));
          const wait = Math.max(1, Math.ceil((MANUAL_POLL_GAP_MS - since) / 1000));
          throw new MockHttpError(
            429,
            "poll_too_soon",
            `Checked ${ago} ${ago === 1 ? "second" : "seconds"} ago. Try again in ${wait} ${wait === 1 ? "second" : "seconds"}.`,
          );
        }
        const poll: MockPoll = {
          id: store.nextId("tsk"),
          profileId: profile.id,
          startedAt: now,
          createdAt: store.clock.now().toISOString(),
          reply: polls.size % 2 === 0,
        };
        polls.set(poll.id, poll);
        return describePoll(store, poll);
      }),

      handle(API_ROUTES.mailboxPollGet, ({ params }) => {
        profileOf(store, params.id);
        const poll = polls.get(params.taskId);
        if (!poll || poll.profileId !== params.id) throw notFound("That check");
        return describePoll(store, poll);
      }),

      handle(API_ROUTES.mailboxFolders, ({ params }) => {
        const profile = profileOf(store, params.id);
        if (!profile.mailbox) throw new MockHttpError(409, "conflict", "Connect a mailbox first.");
        return { folders: FOLDERS };
      }),
    ];
  },
});
