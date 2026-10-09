#!/usr/bin/env node
// Encrypts and decrypts Kick Rocks backups, run by install.sh inside the server image so the host
// needs no tool. The server image has node and nothing else that encrypts: no openssl, no gpg.
//
// usage: node backup-crypt.mjs encrypt|decrypt PASSPHRASE_FILE   (data on stdin, result on stdout)
//
// File layout, everything big-endian:
//   header   "KRBK", version 1, log2(N), r, p, 16 byte salt          24 bytes
//   check    HMAC-SHA256 over the header, keyed by the passphrase    32 bytes
//   chunks   length (4), ciphertext, AES-256-GCM tag (16), repeated; the last one is marked final
// The scrypt cost is stored in the header, so raising it later never locks out an old backup.
// The check tells a wrong passphrase from a damaged file, which the chunks alone cannot.
import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const MAGIC = Buffer.from("KRBK");
export const VERSION = 1;
const HEADER_BYTES = 24;
const CHECK_BYTES = 32;
const TAG_BYTES = 16;
export const CHUNK_BYTES = 1024 * 1024;
const SCRYPT = { log2N: 17, r: 8, p: 1 };
const SCRYPT_MAX_LOG2N = 22;

export const EXIT_WRONG_PASSPHRASE = 2;
export const EXIT_DAMAGED = 3;
export const EXIT_USAGE = 64;

export class CryptError extends Error {
  constructor(message, exitCode) {
    super(message);
    this.exitCode = exitCode;
  }
}

/** The first line of the file, the way openssl reads it, so a blank first line is no passphrase. */
export function passphraseFrom(text) {
  const line = text.split("\n", 1)[0].replace(/\r$/, "");
  if (line.length === 0) {
    throw new CryptError("The first line of the passphrase file is empty.", EXIT_USAGE);
  }
  return line;
}

function deriveKeys(passphrase, header) {
  const log2N = header[5];
  if (log2N > SCRYPT_MAX_LOG2N)
    throw new CryptError("The backup asks for more memory than is allowed.", EXIT_DAMAGED);
  const r = header[6];
  const p = header[7];
  const salt = header.subarray(8, 24);
  const master = scryptSync(passphrase, salt, 32, {
    N: 2 ** log2N,
    r,
    p,
    maxmem: 256 * 2 ** 20 + 128 * r * 2 ** log2N,
  });
  return {
    encryption: Buffer.from(hkdfSync("sha256", master, salt, "kickrocks-backup encryption", 32)),
    check: Buffer.from(hkdfSync("sha256", master, salt, "kickrocks-backup check", 32)),
  };
}

const checkOf = (checkKey, header) => createHmac("sha256", checkKey).update(header).digest();

function nonceFor(index) {
  const nonce = Buffer.alloc(12);
  nonce.writeBigUInt64BE(BigInt(index), 4);
  return nonce;
}

const additionalData = (header, final) => Buffer.concat([header, Buffer.from([final ? 1 : 0])]);

function sealChunk(key, header, index, plain, final) {
  const cipher = createCipheriv("aes-256-gcm", key, nonceFor(index));
  cipher.setAAD(additionalData(header, final));
  const body = Buffer.concat([cipher.update(plain), cipher.final()]);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length);
  return Buffer.concat([length, body, cipher.getAuthTag()]);
}

function openChunk(key, header, index, body, tag, final) {
  const decipher = createDecipheriv("aes-256-gcm", key, nonceFor(index));
  decipher.setAAD(additionalData(header, final));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(body), decipher.final()]);
  } catch {
    return null;
  }
}

/** Encrypts `source` (an async iterable of buffers) and yields the backup file in pieces. */
export async function* encrypt(source, passphrase) {
  const header = Buffer.concat([
    MAGIC,
    Buffer.from([VERSION, SCRYPT.log2N, SCRYPT.r, SCRYPT.p]),
    randomBytes(16),
  ]);
  const keys = deriveKeys(passphrase, header);
  yield header;
  yield checkOf(keys.check, header);
  let pending = Buffer.alloc(0);
  let index = 0;
  for await (const piece of source) {
    pending = Buffer.concat([pending, piece]);
    while (pending.length > CHUNK_BYTES) {
      yield sealChunk(keys.encryption, header, index++, pending.subarray(0, CHUNK_BYTES), false);
      pending = pending.subarray(CHUNK_BYTES);
    }
  }
  yield sealChunk(keys.encryption, header, index, pending, true);
}

/** Reads exactly `size` bytes, or fewer at the end of the stream. */
function reader(source) {
  const iterator = (async function* () {
    for await (const piece of source) yield piece;
  })();
  let held = Buffer.alloc(0);
  return async (size) => {
    while (held.length < size) {
      const next = await iterator.next();
      if (next.done) break;
      held = Buffer.concat([held, next.value]);
    }
    const taken = held.subarray(0, size);
    held = held.subarray(size);
    return taken;
  };
}

/** Decrypts a backup file from `source` and yields the plain archive, one authenticated chunk at a time. */
export async function* decrypt(source, passphrase) {
  const take = reader(source);
  const header = await take(HEADER_BYTES);
  if (header.length < HEADER_BYTES || !header.subarray(0, 4).equals(MAGIC)) {
    throw new CryptError("This is not a Kick Rocks encrypted backup.", EXIT_DAMAGED);
  }
  if (header[4] !== VERSION) {
    throw new CryptError(
      `This backup was written in format ${header[4]}, which this version cannot read.`,
      EXIT_DAMAGED,
    );
  }
  const keys = deriveKeys(passphrase, header);
  const check = await take(CHECK_BYTES);
  const expected = checkOf(keys.check, header);
  if (check.length !== CHECK_BYTES || !timingSafeEqual(check, expected)) {
    throw new CryptError("The passphrase does not open this backup.", EXIT_WRONG_PASSPHRASE);
  }
  for (let index = 0; ; index += 1) {
    const prefix = await take(4);
    if (prefix.length < 4)
      throw new CryptError("The backup is cut short: its last part is missing.", EXIT_DAMAGED);
    const length = prefix.readUInt32BE();
    if (length > CHUNK_BYTES) throw new CryptError("The backup is damaged.", EXIT_DAMAGED);
    const body = await take(length);
    const tag = await take(TAG_BYTES);
    if (body.length < length || tag.length < TAG_BYTES) {
      throw new CryptError("The backup is cut short: its last part is missing.", EXIT_DAMAGED);
    }
    const middle = openChunk(keys.encryption, header, index, body, tag, false);
    if (middle) {
      yield middle;
      continue;
    }
    const last = openChunk(keys.encryption, header, index, body, tag, true);
    if (!last) throw new CryptError("The backup is damaged or has been altered.", EXIT_DAMAGED);
    if ((await take(1)).length > 0) {
      throw new CryptError("The backup is damaged: data follows its end.", EXIT_DAMAGED);
    }
    yield last;
    return;
  }
}

async function writeAll(stream, pieces) {
  for await (const piece of pieces) {
    if (!stream.write(piece)) await new Promise((done) => stream.once("drain", done));
  }
}

async function main(args) {
  const [mode, file] = args;
  if ((mode !== "encrypt" && mode !== "decrypt") || !file) {
    throw new CryptError("usage: backup-crypt.mjs encrypt|decrypt PASSPHRASE_FILE", EXIT_USAGE);
  }
  const passphrase = passphraseFrom(readFileSync(file, "utf8"));
  const run = mode === "encrypt" ? encrypt : decrypt;
  await writeAll(process.stdout, run(process.stdin, passphrase));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof CryptError ? error.message : `backup-crypt failed: ${error.message}`,
    );
    process.exitCode = error instanceof CryptError ? error.exitCode : 1;
  });
}
