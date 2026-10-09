import {
  API_ROUTES,
  type FoundMessage,
  IGNORED_KEEP_DAYS,
  type IgnoredMessage,
  type IntakeCleanup,
  type IntakeSender,
  type Mailbox,
  type MailFolder,
  type MailLine,
  type MessageSummary,
  type ProviderPreset,
  type ShadowLine,
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
    plusAddressing: true,
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
    plusAddressing: true,
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
    plusAddressing: true,
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
    plusAddressing: true,
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
    plusAddressing: false,
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
    plusAddressing: true,
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
    plusAddressing: false,
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
    plusAddressing: false,
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
    plusAddressing: false,
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
    plusAddressing: true,
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

function profileOf(store: MockStore, id: string) {
  const profile = store.profiles.find((candidate) => candidate.id === id);
  if (!profile) throw notFound("That profile");
  return profile;
}

function mailboxOf(store: MockStore, profileId: string): Mailbox {
  const profile = profileOf(store, profileId);
  if (!profile.mailbox) throw new MockHttpError(409, "conflict", "Connect a mailbox first.");
  return profile.mailbox;
}

/** A message the mock search can find. "Take in" stores it, as the server would. */
interface Findable {
  found: FoundMessage;
  fromAddress: string;
}

/** What the mock inbox holds for the three lists a person confirms, takes back or checks. */
interface IntakeLists {
  cleanup: { state: IntakeCleanup["state"]; items: MailLine[]; removed: number | null };
  ignored: IgnoredMessage[];
  shadow: { active: boolean; until: string; items: ShadowLine[] };
}

const SAVED_NOISE: Array<[string, string, number]> = [
  ["Your order has shipped", "orders@shop-example.test", 3],
  ["Summer sale: 40% off everything", "deals@news.shop-example.test", 5],
  ["Security alert: new sign-in", "alerts@bank-example.test", 6],
  ["Your weekly digest", "digest@letters-example.test", 8],
  ["Confirm your new email address", "accounts@store-example.test", 9],
  ["Invoice for September", "billing@cloud-example.test", 11],
  ["Meeting moved to Thursday", "calendar@work-example.test", 12],
  ["New message from a neighbour", "notify@neighbours-example.test", 14],
  ["Your statement is ready", "statements@bank-example.test", 17],
  ["Track your parcel", "tracking@post-example.test", 19],
  ["We miss you", "hello@news.store-example.test", 21],
  ["Receipt for your payment", "receipts@pay-example.test", 24],
];

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
      companyMail: "privacy_only",
      replyAlias: null,
      replyAliasVerified: false,
      lastPollScanned: 143,
      lastPollKept: 4,
      createdAt: store.ago({ days: 90 }),
    };
    jordan.mailbox = mailbox;
    jordan.mailboxConnected = true;
  },

  routes: (store) => {
    const lists: IntakeLists = {
      cleanup: {
        state: "review",
        items: SAVED_NOISE.map(([subject, fromAddress, days], index) => ({
          id: `noise-${index}`,
          fromAddress,
          subject,
          receivedAt: store.ago({ days }),
        })),
        removed: null,
      },
      ignored: [],
      shadow: {
        active: true,
        until: new Date(store.clock.now().getTime() + 5 * 86_400_000).toISOString(),
        items: [
          {
            id: "shadow-1",
            fromAddress: "support@datasafe-support.net",
            subject: "Your privacy request: next steps",
            receivedAt: store.ago({ days: 1 }),
            rule: "finished_request",
          },
          {
            id: "shadow-2",
            fromAddress: "deals@news.peoplefinder-example.test",
            subject: "Records removed from your profile",
            receivedAt: store.ago({ days: 2 }),
            rule: "bulk_no_privacy",
          },
          {
            id: "shadow-3",
            fromAddress: "orders@shop-example.test",
            subject: "About your data on our site",
            receivedAt: store.ago({ days: 3 }),
            rule: "company_not_privacy",
          },
          {
            id: "shadow-4",
            fromAddress: "someone@elsewhere-example.test",
            subject: "Please delete your data",
            receivedAt: store.ago({ days: 4 }),
            rule: "not_named",
          },
        ],
      },
    };
    const senders: IntakeSender[] = [];
    const findable: Findable[] = [
      {
        fromAddress: "help@datasafe-support.net",
        found: {
          uid: 4101,
          uidValidity: 1,
          fromAddress: "help@datasafe-support.net",
          subject: "Your privacy request",
          receivedAt: store.ago({ days: 2 }),
          stored: false,
          admittedBy: null,
        },
      },
      {
        fromAddress: "help@datasafe-support.net",
        found: {
          uid: 4102,
          uidValidity: 1,
          fromAddress: "help@datasafe-support.net",
          subject: "Weekly product news",
          receivedAt: store.ago({ days: 4 }),
          stored: false,
          admittedBy: null,
        },
      },
    ];
    return routesFor(store, senders, findable, lists);
  },
});

function routesFor(
  store: MockStore,
  senders: IntakeSender[],
  findable: Findable[],
  lists: IntakeLists,
) {
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
        companyMail: profile.mailbox?.companyMail ?? "privacy_only",
        replyAlias: profile.mailbox?.replyAlias ?? null,
        replyAliasVerified: profile.mailbox?.replyAliasVerified ?? false,
        lastPollScanned: profile.mailbox?.lastPollScanned ?? 0,
        lastPollKept: profile.mailbox?.lastPollKept ?? 0,
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

    handle(API_ROUTES.mailboxIntake, ({ params, body }) => {
      const mailbox = mailboxOf(store, params.id);
      mailbox.companyMail = body.companyMail;
      return mailbox;
    }),

    handle(API_ROUTES.intakeCleanup, ({ params }) => {
      mailboxOf(store, params.id);
      return {
        state: lists.cleanup.state,
        items: lists.cleanup.state === "review" ? lists.cleanup.items : [],
        removed: lists.cleanup.removed,
      };
    }),

    handle(API_ROUTES.intakeCleanupConfirm, ({ params }) => {
      mailboxOf(store, params.id);
      if (lists.cleanup.state !== "review") {
        throw new MockHttpError(409, "nothing_to_confirm", "There is no list waiting.");
      }
      const keptUntil = new Date(
        store.clock.now().getTime() + IGNORED_KEEP_DAYS * 86_400_000,
      ).toISOString();
      lists.ignored.push(...lists.cleanup.items.map((item) => ({ ...item, keptUntil })));
      const removed = lists.cleanup.items.length;
      lists.cleanup = { state: "done", items: [], removed };
      return { removed };
    }),

    handle(API_ROUTES.intakeCleanupKeep, ({ params }) => {
      mailboxOf(store, params.id);
      lists.cleanup = { state: "done", items: [], removed: 0 };
      return { ok: true as const };
    }),

    handle(API_ROUTES.intakeIgnored, ({ params }) => {
      mailboxOf(store, params.id);
      return { items: [...lists.ignored] };
    }),

    handle(API_ROUTES.intakeIgnoredTakeIn, ({ params }) => {
      const mailbox = mailboxOf(store, params.id);
      const index = lists.ignored.findIndex((item) => item.id === params.messageId);
      const item = lists.ignored[index];
      if (!item) throw notFound("That message");
      lists.ignored.splice(index, 1);
      return takenIn(store, mailbox.id, item);
    }),

    handle(API_ROUTES.intakeShadow, ({ params }) => {
      mailboxOf(store, params.id);
      return {
        active: lists.shadow.active,
        until: lists.shadow.until,
        items: lists.shadow.active ? [...lists.shadow.items] : [],
      };
    }),

    handle(API_ROUTES.intakeShadowTakeIn, ({ params }) => {
      const mailbox = mailboxOf(store, params.id);
      const index = lists.shadow.items.findIndex((item) => item.id === params.shadowId);
      const item = lists.shadow.items[index];
      if (!item) throw notFound("That message");
      lists.shadow.items.splice(index, 1);
      return takenIn(store, mailbox.id, item);
    }),

    handle(API_ROUTES.intakeShadowDismiss, ({ params }) => {
      mailboxOf(store, params.id);
      lists.shadow = { ...lists.shadow, active: false, items: [] };
      return { ok: true as const };
    }),

    // An address that starts with "drop" stands for a provider that discards the tag, so the
    // failed test can be seen.
    handle(API_ROUTES.mailboxAliasEnable, ({ params }) => {
      const mailbox = mailboxOf(store, params.id);
      const at = mailbox.address.lastIndexOf("@");
      mailbox.replyAlias = `${mailbox.address.slice(0, at)}+p7x3a1${mailbox.address.slice(at)}`;
      const dropped = mailbox.address.startsWith("drop");
      mailbox.replyAliasVerified = !dropped;
      return {
        mailbox,
        verified: !dropped,
        problem: dropped
          ? "The test mail did not arrive in this mailbox, so replies sent to the address would be lost"
          : null,
      };
    }),

    handle(API_ROUTES.mailboxAliasDisable, ({ params }) => {
      const mailbox = mailboxOf(store, params.id);
      mailbox.replyAlias = null;
      mailbox.replyAliasVerified = false;
      return mailbox;
    }),

    handle(API_ROUTES.intakeSendersList, ({ params }) => {
      mailboxOf(store, params.id);
      return { senders: [...senders] };
    }),

    handle(API_ROUTES.intakeSenderAdd, ({ params, body }) => {
      mailboxOf(store, params.id);
      const target = store.targets.find((candidate) => candidate.id === body.targetId);
      if (!target) throw notFound("That target");
      const value = body.value.trim().toLowerCase();
      const existing = senders.find((sender) => sender.value === value);
      if (existing) return existing;
      const sender: IntakeSender = {
        id: store.nextId("snd"),
        targetId: target.id,
        targetName: target.name,
        kind: value.includes("@") ? "address" : "domain",
        value,
      };
      senders.push(sender);
      return sender;
    }),

    handle(API_ROUTES.intakeSenderRemove, ({ params }) => {
      mailboxOf(store, params.id);
      const index = senders.findIndex((sender) => sender.id === params.senderId);
      if (index === -1) throw notFound("That sender");
      senders.splice(index, 1);
      return { ok: true as const };
    }),

    handle(API_ROUTES.mailboxFind, ({ params, body }) => {
      mailboxOf(store, params.id);
      const query = body.query.trim().toLowerCase();
      return {
        searched: true,
        messages: findable
          .filter(({ fromAddress }) => fromAddress.includes(query))
          .map(({ found }) => found),
      };
    }),

    handle(API_ROUTES.mailboxTakeIn, ({ params, body }) => {
      const mailbox = mailboxOf(store, params.id);
      const hit = findable.find(({ found }) => found.uid === body.uid);
      if (!hit) throw new MockHttpError(409, "message_gone", "That message is no longer there.");
      hit.found.stored = true;
      hit.found.admittedBy = "person";
      const message: MessageSummary = {
        id: store.nextId("msg"),
        mailboxId: mailbox.id,
        requestId: null,
        fromAddress: hit.fromAddress,
        subject: hit.found.subject,
        receivedAt: hit.found.receivedAt ?? store.clock.now().toISOString(),
        classification: "unknown",
        confidence: 0.2,
        rationale: "Taken in by hand",
        links: [],
        requestedFields: [],
        snippet: null,
        reviewed: false,
        admittedBy: "person",
      };
      return message;
    }),
  ];
}

/** A message the person took in by hand, as it would appear in Review. */
function takenIn(store: MockStore, mailboxId: string, line: MailLine): MessageSummary {
  return {
    id: store.nextId("msg"),
    mailboxId,
    requestId: null,
    fromAddress: line.fromAddress,
    subject: line.subject,
    receivedAt: line.receivedAt ?? store.clock.now().toISOString(),
    classification: "unknown",
    confidence: 0.2,
    rationale: "Taken in by hand",
    links: [],
    requestedFields: [],
    snippet: null,
    reviewed: false,
    admittedBy: "person",
  };
}
