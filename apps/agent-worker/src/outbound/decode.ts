import * as zlib from "node:zlib";
import { brotliDecompressSync, gunzipSync, inflateRawSync, inflateSync } from "node:zlib";

/** How many layers of encoding a value is unpacked through. A request with one more counts as unreadable. */
const MAX_DEPTH = 3;
/** How many readings of one request are tried before it counts as one that cannot be read. */
const MAX_VARIANTS = 600;
/** The most text read out of one request, however it was packed. */
const MAX_TOTAL_CHARS = 16_000_000;
/** A packed body that grows past this when unpacked is treated as a bomb. */
const MAX_UNPACKED_BYTES = 8 * 1024 * 1024;

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

type Input = string | Buffer;

export interface Packaged {
  data: Input;
  /** The Content-Encoding the data was sent with, when it said. */
  contentEncoding?: string | undefined;
}

export interface Reading {
  /** Every reading of the input, in the order they were found, the input itself first. */
  texts: string[];
  /** Some layer could not be unpacked or the input was too large to read in full. */
  overflow: boolean;
}

function percentDecode(text: string): string {
  return text.replace(/(?:%[0-9a-f]{2})+/gi, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      // A run that is not valid UTF-8 is decoded byte by byte, as a browser would.
      return run.replace(/%([0-9a-f]{2})/gi, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      );
    }
  });
}

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      return String.fromCodePoint(Number.parseInt(body.slice(2), 16) || 0xfffd);
    }
    if (body.startsWith("#")) return String.fromCodePoint(Number(body.slice(1)) || 0xfffd);
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

function unescapeJson(text: string): string {
  return text
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex: string) =>
      String.fromCharCode(Number.parseInt(hex, 16)),
    )
    .replace(/\\\//g, "/");
}

function jsonLeaves(value: unknown, out: string[]): void {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "number" || typeof value === "boolean") out.push(String(value));
  else if (Array.isArray(value)) for (const item of value) jsonLeaves(item, out);
  else if (value !== null && typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      out.push(key);
      jsonLeaves(item, out);
    }
  }
}

/** A packed value that goes deeper than is unpacked, so what is inside it is unknown. */
class TooManyLayers extends Error {}

/** The unpacked size went past the limit, which a guess at a hidden layer may not ignore. */
function isTooLarge(error: unknown): boolean {
  return (
    error instanceof TooManyLayers || (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE"
  );
}

function looksTextual(bytes: Buffer): boolean {
  if (bytes.length === 0) return false;
  const text = bytes.toString("utf8");
  let odd = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0xfffd || (code < 32 && code !== 9 && code !== 10 && code !== 13)) odd += 1;
  }
  return odd / text.length <= 0.1;
}

function isGzip(bytes: Buffer): boolean {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

function isZlib(bytes: Buffer): boolean {
  if (bytes.length < 2 || bytes[0] !== 0x78) return false;
  const second = bytes[1] ?? 0;
  return ((bytes[0] ?? 0) * 256 + second) % 31 === 0;
}

function isZstd(bytes: Buffer): boolean {
  return (
    bytes.length > 4 &&
    bytes[0] === 0x28 &&
    bytes[1] === 0xb5 &&
    bytes[2] === 0x2f &&
    bytes[3] === 0xfd
  );
}

const zstdDecompress = (zlib as { zstdDecompressSync?: (b: Buffer, o?: object) => Buffer })
  .zstdDecompressSync;

function unpackOnce(bytes: Buffer, encoding: string): Buffer {
  const limit = { maxOutputLength: MAX_UNPACKED_BYTES };
  switch (encoding) {
    case "gzip":
    case "x-gzip":
      return gunzipSync(bytes, limit);
    case "deflate":
      try {
        return inflateSync(bytes, limit);
      } catch (error) {
        if (isTooLarge(error)) throw error;
        return inflateRawSync(bytes, limit);
      }
    case "br":
      return brotliDecompressSync(bytes, limit);
    case "zstd":
      if (zstdDecompress === undefined) throw new Error("zstd is not available");
      return zstdDecompress(bytes, limit);
    default:
      return bytes;
  }
}

/**
 * Unpacks a body by its Content-Encoding and, since a page can pack a body and say nothing, by
 * the magic bytes of gzip, zlib and zstd. A layer that cannot be unpacked fails the whole read,
 * because what is inside it is unknown.
 */
export function unpack(bytes: Buffer, contentEncoding?: string): Buffer {
  let data = bytes;
  const declared = (contentEncoding ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name !== "" && name !== "identity")
    .reverse();
  for (const name of declared) data = unpackOnce(data, name);
  for (let layer = 0; ; layer++) {
    if (!isGzip(data) && !isZstd(data) && !isZlib(data)) return data;
    if (layer >= MAX_DEPTH) throw new TooManyLayers("packed deeper than is unpacked");
    if (isGzip(data)) data = unpackOnce(data, "gzip");
    else if (isZstd(data)) data = unpackOnce(data, "zstd");
    else {
      try {
        data = unpackOnce(data, "deflate");
      } catch (error) {
        if (isTooLarge(error)) throw error;
        return data;
      }
    }
  }
}

/** The text of some bytes, with the Latin-1 reading added when UTF-8 could not read them. */
function textsOf(bytes: Buffer): string[] {
  const utf8 = bytes.toString("utf8");
  return utf8.includes("�") ? [utf8, bytes.toString("latin1")] : [utf8];
}

function encodedTokens(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(pattern)].map((match) => match[0]);
}

/**
 * The buffers a base64 or hex looking token may hold. A token inside a longer run starts at any
 * of four alignments of the encoded form, so each alignment is decoded.
 */
function decodedTokens(text: string): Buffer[] {
  const buffers: Buffer[] = [];
  for (const token of encodedTokens(text, /[A-Za-z0-9+/_-]{8,}={0,2}/g)) {
    const standard = token.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
    for (let skip = 0; skip < 4; skip++) {
      const usable = standard.slice(skip);
      if (usable.length < 8) continue;
      const bytes = Buffer.from(usable, "base64");
      if (looksTextual(bytes) || isGzip(bytes) || isZstd(bytes) || isZlib(bytes)) {
        buffers.push(bytes);
      }
    }
  }
  for (const token of encodedTokens(text, /(?:[0-9a-f]{2}){4,}/gi)) {
    const bytes = Buffer.from(token, "hex");
    if (looksTextual(bytes) || isGzip(bytes) || isZstd(bytes) || isZlib(bytes)) buffers.push(bytes);
  }
  return buffers;
}

function derive(text: string, state: { overflow: boolean }): Input[] {
  const derived: Input[] = [];
  if (/%[0-9a-f]{2}/i.test(text)) derived.push(percentDecode(text));
  if (text.includes("+")) derived.push(percentDecode(text.replace(/\+/g, " ")));
  const trimmed = text.trimStart();
  if (/^[[{"]/.test(trimmed)) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      // Not JSON, or cut short: the text itself is still read below.
    }
    if (parsed !== undefined) {
      const leaves: string[] = [];
      try {
        jsonLeaves(parsed, leaves);
      } catch {
        // Nested too deeply to walk, so the values inside are not all read.
        state.overflow = true;
      }
      for (const leaf of leaves) derived.push(leaf);
    }
  }
  if (/\\u[0-9a-f]{4}|\\\//i.test(text)) derived.push(unescapeJson(text));
  if (text.includes("&")) derived.push(decodeEntities(text));
  derived.push(...decodedTokens(text));
  return derived;
}

/**
 * Every way a piece of a request can be read as text: itself, then what it holds once percent
 * encoding, JSON, escapes, entities, base64, hex and compression are undone, up to three layers
 * deep. The person's values are looked for in all of them.
 */
export function readAll(inputs: readonly Packaged[]): Reading {
  const seen = new Set<string>();
  const texts: string[] = [];
  let chars = 0;
  const state = { overflow: false };
  const queue: { data: Input; depth: number; contentEncoding?: string | undefined }[] = inputs.map(
    (input) => ({ ...input, depth: 0 }),
  );
  while (queue.length > 0) {
    const item = queue.shift();
    if (item === undefined) break;
    let strings: string[];
    if (typeof item.data === "string") {
      strings = [item.data];
    } else {
      try {
        const bytes = unpack(item.data, item.contentEncoding);
        strings = textsOf(bytes);
      } catch (error) {
        // A guess at a hidden layer may be noise, but a layer too large or too deep to open is not.
        if (item.depth === 0 || isTooLarge(error)) state.overflow = true;
        continue;
      }
    }
    for (const text of strings) {
      if (seen.has(text)) continue;
      if (texts.length >= MAX_VARIANTS || chars + text.length > MAX_TOTAL_CHARS) {
        state.overflow = true;
        break;
      }
      seen.add(text);
      texts.push(text);
      chars += text.length;
      const derived = derive(text, state);
      if (item.depth < MAX_DEPTH) {
        for (const next of derived) queue.push({ data: next, depth: item.depth + 1 });
      } else if (derived.some((next) => typeof next !== "string" || !seen.has(next))) {
        state.overflow = true;
      }
    }
  }
  return { texts, overflow: state.overflow };
}
