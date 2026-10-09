import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  CHUNK_BYTES,
  CryptError,
  decrypt,
  EXIT_DAMAGED,
  EXIT_WRONG_PASSPHRASE,
  encrypt,
  passphraseFrom,
} from "./backup-crypt.mjs";

const collect = async (pieces) => Buffer.concat(await Array.fromAsync(pieces));
const seal = (plain, passphrase = "correct horse") => collect(encrypt([plain], passphrase));
const open = (file, passphrase = "correct horse") => collect(decrypt([file], passphrase));

describe("backup-crypt", () => {
  it("round-trips data of several sizes, including none and an exact chunk", async () => {
    for (const size of [0, 1, CHUNK_BYTES - 1, CHUNK_BYTES, CHUNK_BYTES + 1, 2 * CHUNK_BYTES + 5]) {
      const plain = randomBytes(size);
      assert.ok((await open(await seal(plain))).equals(plain), `size ${size}`);
    }
  });

  it("reads the same file whatever size the stream arrives in", async () => {
    const plain = randomBytes(CHUNK_BYTES + 100);
    const file = await seal(plain);
    const pieces = Array.from({ length: Math.ceil(file.length / 1000) }, (_, i) =>
      file.subarray(i * 1000, (i + 1) * 1000),
    );
    assert.ok((await collect(decrypt(pieces, "correct horse"))).equals(plain));
  });

  it("says a wrong passphrase is wrong, apart from a damaged file", async () => {
    const file = await seal(Buffer.from("data"));
    await assert.rejects(open(file, "wrong"), { exitCode: EXIT_WRONG_PASSPHRASE });
    const damaged = Buffer.from(file);
    damaged[damaged.length - 20] ^= 1;
    await assert.rejects(open(damaged), { exitCode: EXIT_DAMAGED });
  });

  it("refuses a file that was cut short at a chunk edge", async () => {
    const file = await seal(randomBytes(2 * CHUNK_BYTES + 10));
    const firstChunk = 24 + 32 + 4 + CHUNK_BYTES + 16;
    await assert.rejects(open(file.subarray(0, firstChunk)), { exitCode: EXIT_DAMAGED });
    await assert.rejects(open(file.subarray(0, file.length - 1)), { exitCode: EXIT_DAMAGED });
  });

  it("refuses chunks that were swapped, and data added after the end", async () => {
    const file = await seal(randomBytes(3 * CHUNK_BYTES));
    const start = 24 + 32;
    const size = 4 + CHUNK_BYTES + 16;
    const swapped = Buffer.concat([
      file.subarray(0, start),
      file.subarray(start + size, start + 2 * size),
      file.subarray(start, start + size),
      file.subarray(start + 2 * size),
    ]);
    await assert.rejects(open(swapped), { exitCode: EXIT_DAMAGED });
    await assert.rejects(open(Buffer.concat([file, Buffer.from("x")])), { exitCode: EXIT_DAMAGED });
  });

  it("refuses a blank first line in the passphrase file, which openssl would read as no passphrase", () => {
    assert.throws(() => passphraseFrom("\nsecret\n"), CryptError);
    assert.equal(passphraseFrom("secret\r\nignored\n"), "secret");
  });
});

describe("backup-crypt command line", () => {
  let dir;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "kr-crypt-"));
    writeFileSync(join(dir, "pass"), "correct horse\n");
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  const run = (mode, input) =>
    spawnSync("node", [join(import.meta.dirname, "backup-crypt.mjs"), mode, join(dir, "pass")], {
      input,
      maxBuffer: 64 * 1024 * 1024,
    });

  it("encrypts and decrypts through stdin and stdout, and exits non-zero on a damaged file", () => {
    const plain = randomBytes(300_000);
    const sealed = run("encrypt", plain);
    assert.equal(sealed.status, 0, sealed.stderr.toString());
    const opened = run("decrypt", sealed.stdout);
    assert.equal(opened.status, 0);
    assert.ok(opened.stdout.equals(plain));
    const damaged = Buffer.from(sealed.stdout);
    damaged[100] ^= 1;
    assert.equal(run("decrypt", damaged).status, EXIT_DAMAGED);
  });
});
