import { isIP } from "node:net";

/**
 * Whether a host name is this machine. Bridge-style local relays and the test mail server use a
 * self-signed or absent TLS setup, which is acceptable only when nothing crosses the network.
 */
export function isLoopbackHost(host: string): boolean {
  const name = host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
  if (name === "localhost" || name.endsWith(".localhost")) return true;
  switch (isIP(name)) {
    case 4:
      return name.startsWith("127.");
    case 6:
      return name === "::1" || name === "0:0:0:0:0:0:0:1";
    default:
      return false;
  }
}

/**
 * Whether credentials may cross to this host without TLS: this machine, or a host the operator
 * named in `KICKROCKS_PLAINTEXT_MAIL_HOSTS`, which is how the development stack reaches its
 * GreenMail container.
 */
export function isTrustedPlaintextHost(host: string, trusted: readonly string[] = []): boolean {
  return isLoopbackHost(host) || trusted.includes(host.trim().toLowerCase());
}

const AUTH_CODES = new Set(["EAUTH", "AUTHENTICATIONFAILED", "NOAUTH", "AUTHENTICATIONFAILURE"]);

const ERROR_TEXT: Record<string, string> = {
  ECONNREFUSED: "The server refused the connection. Check the host and port.",
  ENOTFOUND: "The host name could not be found. Check the spelling.",
  EAI_AGAIN: "The host name could not be looked up right now.",
  ETIMEDOUT: "The server did not answer in time.",
  CONNECT_TIMEOUT: "The server did not answer in time.",
  GREETING_TIMEOUT: "The server did not answer in time.",
  ECONNECTION: "The connection failed.",
  ESOCKET: "The connection failed.",
  ECONNRESET: "The server closed the connection.",
  EHOSTUNREACH: "The server could not be reached.",
  ENETUNREACH: "The server could not be reached.",
  ETLS: "The secure connection could not be set up. Check the port and the secure setting.",
  EAUTH: "The server rejected the username or app password.",
  AUTHENTICATIONFAILED: "The server rejected the username or app password.",
  NOAUTH: "The server rejected the username or app password.",
  AUTHENTICATIONFAILURE: "The server rejected the username or app password.",
  CERT_HAS_EXPIRED: "The server's certificate has expired.",
  DEPTH_ZERO_SELF_SIGNED_CERT: "The server's certificate is self-signed, so it cannot be trusted.",
  SELF_SIGNED_CERT_IN_CHAIN: "The server's certificate is self-signed, so it cannot be trusted.",
  UNABLE_TO_VERIFY_LEAF_SIGNATURE: "The server's certificate could not be verified.",
  ERR_TLS_CERT_ALTNAME_INVALID: "The server's certificate is for a different host name.",
  NONEXISTENT: "That folder does not exist on the server.",
};

const MAILBOX_PROBLEM_CODES = [
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "ECONNECTION",
  "ESOCKET",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "ETLS",
  "EAUTH",
];

/**
 * Whether a stored failure message says the mailbox could not connect or log in. Failures recorded
 * before sends were held for a bad mailbox kept only this sentence, so it is all there is to go on.
 */
export function isMailboxProblemMessage(message: string): boolean {
  const sentences = MAILBOX_PROBLEM_CODES.map((code) => ERROR_TEXT[code]);
  return sentences.some((sentence) => sentence !== undefined && message.startsWith(sentence));
}

/**
 * Nodemailer and node report a certificate failure under a generic socket code, with only the
 * OpenSSL wording in the message, so the message is what says which certificate problem it was.
 */
const CERTIFICATE_MESSAGES: ReadonlyArray<readonly [RegExp, string]> = [
  [
    /self[- ]signed certificate/i,
    "The server's certificate is self-signed, so it cannot be trusted.",
  ],
  [/certificate has expired/i, "The server's certificate has expired."],
  [
    /unable to verify the (first|leaf) certificate|unable to get local issuer certificate|unable to verify the leaf signature/i,
    "The server's certificate could not be verified.",
  ],
  [
    /does not match certificate's altnames|hostname\/ip does not match/i,
    "The server's certificate is for a different host name.",
  ],
];

/** Error codes along the chain of causes, outermost first, since a wrapper can hide the real one. */
function codesAlong(error: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Object; depth += 1) {
    const record = current as Record<string, unknown>;
    for (const value of [record.code, record.serverResponseCode]) {
      if (typeof value === "string") codes.push(value.toUpperCase());
    }
    current = record.cause;
  }
  return codes;
}

/**
 * A short sentence for a person about why a mail connection failed. The password is removed from
 * whatever the library said, so a credential never reaches an error response or a log.
 */
export function describeMailError(error: unknown, secrets: readonly string[] = []): string {
  const record = (error ?? {}) as Record<string, unknown>;
  // Nodemailer wraps socket failures in a generic code and keeps the specific one in the message.
  const socketCode =
    error instanceof Error
      ? /\b(ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|EHOSTUNREACH|ENETUNREACH|EAI_AGAIN)\b/.exec(
          error.message,
        )?.[1]
      : undefined;
  // The innermost code is the most specific, as a wrapper usually carries only a generic one.
  const codes = [...(socketCode ? [socketCode.toUpperCase()] : []), ...codesAlong(error).reverse()];
  const certificate =
    error instanceof Error
      ? CERTIFICATE_MESSAGES.find(([pattern]) => pattern.test(error.message))?.[1]
      : undefined;
  const known = certificate ?? codes.map((code) => ERROR_TEXT[code]).find(Boolean);
  const isAuth = codes.some((code) => AUTH_CODES.has(code)) || record.authenticationFailed === true;
  const serverText =
    typeof record.responseText === "string"
      ? record.responseText
      : typeof record.response === "string"
        ? record.response
        : null;

  let text: string;
  if (isAuth) {
    text = "The server rejected the username or app password.";
    if (serverText) text = `${text} The server said: ${serverText}`;
  } else {
    text =
      known ??
      (error instanceof Error && error.message ? error.message : "The mail server failed.");
  }
  for (const secret of secrets) {
    if (secret.length >= 4) text = text.split(secret).join("[hidden]");
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 300);
}
