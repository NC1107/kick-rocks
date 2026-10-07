import { generateKeyPairSync } from "node:crypto";
import { dkimSign } from "mailauth";
import type { DnsResolver } from "../mail/dkim.js";
import type { DkimCheck } from "../mail/types.js";

/** A throwaway key pair and the helpers to sign mail with it and serve its public key as DNS. */
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const PRIVATE_PEM = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
export const KEY_RECORD = `v=DKIM1; k=rsa; p=${publicKey.export({ type: "spki", format: "der" }).toString("base64")}`;

export const BODY = "We have completed your request.\r\n";

export function unsigned(body = BODY, from = "privacy@acme.test"): string {
  return [
    `From: Acme Privacy <${from}>`,
    "To: jordan@example.com",
    "Subject: Your privacy request",
    "Date: Thu, 01 Oct 2026 12:00:00 +0000",
    "Message-ID: <reply-1@acme.test>",
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
    "",
    body,
  ].join("\r\n");
}

export interface SignOptions {
  domain?: string;
  maxBodyLength?: number;
  /** The header names the signature covers; the signer's default list when omitted. */
  headerList?: string[];
}

export async function signed(message: string, options: SignOptions = {}): Promise<string> {
  const entry = {
    signingDomain: options.domain ?? "acme.test",
    selector: "kr",
    privateKey: PRIVATE_PEM,
    ...(options.maxBodyLength === undefined ? {} : { maxBodyLength: options.maxBodyLength }),
  };
  // The package signs from `signatureData`, but its typings only describe the single-signature form.
  const { signatures, errors } = await dkimSign(message, {
    ...entry,
    ...(options.headerList === undefined ? {} : { headerList: options.headerList }),
    signatureData: [entry],
  });
  if (errors.length > 0) throw new Error(`signing failed: ${JSON.stringify(errors)}`);
  return signatures + message;
}

export function servingKeysFor(...domains: string[]): DnsResolver {
  return async (name, rrtype) => {
    const known = domains.some((domain) => name === `kr._domainkey.${domain}`);
    if (rrtype === "TXT" && known) return [[KEY_RECORD]];
    throw Object.assign(new Error(`no ${rrtype} record for ${name}`), { code: "ENOTFOUND" });
  };
}

/** A DKIM check that reports these signers whatever it is asked, for tests that are not about verification. */
export function verifiedBy(...domains: string[]): DkimCheck {
  return async () => domains;
}

export const noDkim: DkimCheck = verifiedBy();
