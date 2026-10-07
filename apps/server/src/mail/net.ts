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
  const codes = [socketCode, record.code, record.serverResponseCode]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toUpperCase());
  const known = codes.map((code) => ERROR_TEXT[code]).find(Boolean);
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
