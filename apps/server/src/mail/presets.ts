import type { ProviderPreset } from "@kickrocks/shared";

const SUPPORTED = { supported: true, unsupportedReason: null } as const;

/**
 * Daily caps sit well under each provider's published sending limit, because a mailbox that sends
 * a burst of near-identical mail is what gets an app password suspended.
 */
export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
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
      "Turn on 2-Step Verification, then create an app password. Gmail allows about 500 messages a day. IMAP is on by default.",
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
    notes:
      "Your administrator must allow app passwords and IMAP for your account. Workspace allows about 2,000 messages a day.",
    defaultDailyCap: 150,
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
    appPasswordUrl: "https://app.fastmail.com/settings/security/devicekeys/new",
    notes: "Create an app password with access to mail (IMAP, POP, and SMTP).",
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
    notes:
      "Create an app-specific password under Sign-In and Security. The username is your full iCloud address, or the part before the @ when that is rejected.",
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
    notes: "Generate an app password for a custom app. Yahoo allows about 500 messages a day.",
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
      "Bridge must be running and reachable from this server. Use the username and password Bridge shows, not your Proton login. Bridge uses a self-signed certificate, which is accepted only for a local address.",
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
      "Sign in, open Settings, then Security, and add an application password. Two-factor sign-in must be on for the account.",
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
      "Enable IMAP access in Zoho Mail settings and create an application-specific password. Accounts in other regions use their own hosts, such as smtp.zoho.eu, so pick Other provider for those.",
    defaultDailyCap: 100,
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
      "Enter your provider's SMTP and IMAP hosts, which its help pages list. SMTP port 465 uses TLS from the start and port 587 upgrades with STARTTLS. IMAP port 993 uses TLS from the start.",
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
      "Outlook.com, Hotmail, and Live accept IMAP and SMTP sign-in only through OAuth, which Kick Rocks does not support yet. Use another mailbox for now.",
  },
];

export function findProviderPreset(id: string): ProviderPreset | null {
  return PROVIDER_PRESETS.find((preset) => preset.id === id) ?? null;
}
