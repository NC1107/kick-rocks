import {
  type Mailbox,
  MailboxConnection,
  type MailboxInput,
  type MailboxTestBody,
  type MailFolder,
  type ProviderPreset,
} from "@kickrocks/shared";

/** Every field of the wizard as the person typed it, so a half-finished value can sit in an input. */
export interface ConnectionForm {
  providerId: string;
  address: string;
  username: string;
  /** Whether the person edited the username, which otherwise follows the address. */
  usernameEdited: boolean;
  password: string;
  smtpHost: string;
  smtpPort: string;
  smtpSecure: boolean;
  imapHost: string;
  imapPort: string;
  replyFolder: string;
  dailyCap: string;
}

const DEFAULT_REPLY_FOLDER = "INBOX";
const MAX_DAILY_CAP = 2000;

/** A blank form, starting from the profile's own email address, which is usually the mailbox to use. */
export function emptyForm(address = ""): ConnectionForm {
  return {
    providerId: "",
    address,
    username: address,
    usernameEdited: false,
    password: "",
    smtpHost: "",
    smtpPort: "587",
    smtpSecure: false,
    imapHost: "",
    imapPort: "993",
    replyFolder: DEFAULT_REPLY_FOLDER,
    dailyCap: "",
  };
}

export function formFromMailbox(mailbox: Mailbox): ConnectionForm {
  return {
    providerId: mailbox.provider,
    address: mailbox.address,
    username: mailbox.username,
    usernameEdited: mailbox.username !== mailbox.address,
    password: "",
    smtpHost: mailbox.smtpHost,
    smtpPort: String(mailbox.smtpPort),
    smtpSecure: mailbox.smtpSecure,
    imapHost: mailbox.imapHost,
    imapPort: String(mailbox.imapPort),
    replyFolder: mailbox.replyFolder,
    dailyCap: String(mailbox.dailyCap),
  };
}

/** Choosing a provider fills in its servers and its usual daily limit. */
export function applyPreset(form: ConnectionForm, preset: ProviderPreset): ConnectionForm {
  return {
    ...form,
    providerId: preset.id,
    smtpHost: preset.smtpHost,
    smtpPort: String(preset.smtpPort),
    smtpSecure: preset.smtpSecure,
    imapHost: preset.imapHost,
    imapPort: String(preset.imapPort),
    dailyCap: String(preset.defaultDailyCap),
  };
}

export function setAddress(form: ConnectionForm, address: string): ConnectionForm {
  return { ...form, address, username: form.usernameEdited ? form.username : address.trim() };
}

export type FormErrors = Partial<Record<keyof ConnectionForm, string>>;

const portOf = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);
const validPort = (port: number) => Number.isInteger(port) && port >= 1 && port <= 65535;

/**
 * What stops a connection from being tested. A saved mailbox may leave the password empty to
 * keep the stored one.
 */
export function validateConnection(
  form: ConnectionForm,
  { passwordOptional }: { passwordOptional: boolean },
): FormErrors {
  const errors: FormErrors = {};
  if (!form.address.trim()) errors.address = "Required";
  else if (!MailboxConnection.shape.address.safeParse(form.address.trim()).success) {
    errors.address = "Enter a valid email address";
  }
  // Until the person edits it the username is the address, which has its own message above.
  if (!form.username.trim() && form.usernameEdited) errors.username = "Required";
  if (!(form.password || passwordOptional)) errors.password = "Required";
  if (form.password.length > 256) errors.password = "Too long";
  if (!form.smtpHost.trim()) errors.smtpHost = "Required";
  if (!form.imapHost.trim()) errors.imapHost = "Required";
  if (!validPort(portOf(form.smtpPort))) errors.smtpPort = "Use a port from 1 to 65535";
  if (!validPort(portOf(form.imapPort))) errors.imapPort = "Use a port from 1 to 65535";
  return errors;
}

export function validateSettings(form: ConnectionForm): FormErrors {
  const errors: FormErrors = {};
  const cap = portOf(form.dailyCap);
  if (!Number.isInteger(cap) || cap < 1 || cap > MAX_DAILY_CAP) {
    errors.dailyCap = `Use a whole number from 1 to ${MAX_DAILY_CAP}`;
  }
  if (!form.replyFolder.trim()) errors.replyFolder = "Choose a folder";
  return errors;
}

/** The connection part of the form, as the test and save routes take it. */
export function connectionBody(form: ConnectionForm): MailboxTestBody {
  return {
    provider: form.providerId,
    address: form.address.trim(),
    username: form.username.trim(),
    smtpHost: form.smtpHost.trim(),
    smtpPort: portOf(form.smtpPort),
    smtpSecure: form.smtpSecure,
    imapHost: form.imapHost.trim(),
    imapPort: portOf(form.imapPort),
    ...(form.password ? { password: form.password } : {}),
  };
}

export function saveBody(form: ConnectionForm): MailboxInput {
  return {
    ...connectionBody(form),
    replyFolder: form.replyFolder,
    dailyCap: portOf(form.dailyCap),
  };
}

/** A fingerprint of everything a test depends on, so editing a field makes the result stale. */
export function connectionSignature(form: ConnectionForm): string {
  return JSON.stringify(connectionBody(form));
}

const HINTS: readonly { test: RegExp; text: (preset: ProviderPreset | undefined) => string }[] = [
  {
    test: /535|auth|credential|password|login|denied|rejected/i,
    text: (preset) =>
      preset?.appPasswordUrl
        ? "The provider rejected the sign-in. Use an app password, not your account password, and check the username."
        : "The provider rejected the sign-in. Check the username and password.",
  },
  {
    test: /ENOTFOUND|getaddrinfo|host not found|unknown host/i,
    text: () => "The server name was not found. Check the host for typos.",
  },
  {
    test: /ECONNREFUSED|refused/i,
    text: (preset) =>
      preset?.id === "proton-bridge"
        ? "Nothing answered. Start Proton Mail Bridge on this machine, then test again."
        : "Nothing answered on that port. Check the host and the port.",
  },
  {
    test: /ETIMEDOUT|timed out|timeout/i,
    text: () => "The server did not answer in time. Check the host, the port, and your network.",
  },
  {
    test: /certificate|TLS|SSL|handshake/i,
    text: () => "The secure connection failed. Check the port and the secure connection setting.",
  },
];

/** A next step for a failed connection, from what the server said. Undefined when nothing fits. */
export function hintForError(
  error: string | null,
  preset: ProviderPreset | undefined,
): string | undefined {
  if (!error) return undefined;
  return HINTS.find((hint) => hint.test.test(error))?.text(preset);
}

interface FolderChoice {
  path: string;
  label: string;
}

/** Folders for the picker: the inbox first, and the saved folder kept even if the server lost it. */
export function folderChoices(folders: readonly MailFolder[], current: string): FolderChoice[] {
  const rank = (folder: MailFolder) => (folder.specialUse === "\\Inbox" ? 0 : 1);
  const sorted = [...folders].sort(
    (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  const choices = sorted.map((folder) => ({
    path: folder.path,
    label: folder.path === folder.name ? folder.name : `${folder.name} (${folder.path})`,
  }));
  if (current && !choices.some((choice) => choice.path === current)) {
    choices.unshift({ path: current, label: `${current} (not found on the server)` });
  }
  return choices;
}

/** A dedicated folder when the person already made one, otherwise the inbox. */
export function suggestedFolder(folders: readonly MailFolder[]): string {
  const dedicated = folders.find((folder) => /kick\s*rocks/i.test(folder.name));
  return dedicated?.path ?? DEFAULT_REPLY_FOLDER;
}
