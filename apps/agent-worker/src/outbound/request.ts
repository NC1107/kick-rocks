import { createHash } from "node:crypto";
import {
  type CarriedField,
  isContactField,
  type OutgoingRequest,
  type OutgoingValue,
} from "@kickrocks/shared";
import { unpack } from "./decode.js";
import type { Scan, ValueDetector } from "./detector.js";

/** The largest body that is read and shown. A larger one is held back as unreadable. */
export const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_VALUE_CHARS = 4000;
const MAX_ENTRIES = 400;
const MAX_HEADERS = 100;

export interface PostDataEntry {
  bytes?: string;
}

/** The part of a paused request the gate reads, in the shape the DevTools protocol reports it. */
export interface PausedRequest {
  requestId: string;
  networkId?: string;
  resourceType: string;
  frameId?: string;
  responseStatusCode?: number;
  responseHeaders?: { name: string; value: string }[];
  request: {
    url: string;
    urlFragment?: string;
    method?: string;
    headers?: Record<string, string>;
    postData?: string;
    hasPostData?: boolean;
    postDataEntries?: PostDataEntry[];
  };
}

export interface BodyRead {
  bytes: Buffer | null;
  /** The request has a body, whether or not it could be read. */
  present: boolean;
  /** The body is a stream, a file, a blob or larger than the limit, so what it holds is unknown. */
  unreadable: boolean;
}

export interface Cookie {
  name: string;
  value: string;
}

export interface TargetContext {
  type: string;
  frameOrigin: string;
  topLevel: boolean;
}

/** A request as the gate classifies it: the record to store, and what it was found to carry. */
export interface Canonical {
  request: OutgoingRequest;
  scan: Scan;
  body: BodyRead;
  method: string;
  url: string;
  /** Part of the request is missing from the record, so a person cannot have read all of it. */
  truncated: boolean;
}

/**
 * Values a site put in a page it served, by field name. A token that the site itself generated for
 * this load is expected to differ the next time, and the person approving does not need to see it.
 */
export class ServedValues {
  private readonly byName = new Map<string, Set<string>>();

  private note(name: string, value: string): void {
    if (name === "" || value === "" || value.length > MAX_VALUE_CHARS) return;
    const known = this.byName.get(name) ?? new Set<string>();
    if (known.size >= 50) return;
    known.add(value);
    this.byName.set(name, known);
  }

  /** Reads the fields a page or an API answer holds: inputs, meta tags and JSON keys. */
  record(body: string, contentType: string): void {
    if (/json/i.test(contentType)) {
      try {
        this.recordJson(JSON.parse(body), "");
      } catch {
        // An answer that is not JSON has no keys to read.
      }
      return;
    }
    for (const tag of body.match(/<input\b[^>]*>/gi) ?? []) {
      // Only a hidden input carries a value the site generated. The values of a radio, a checkbox or
      // a text input are choices the person made or could have made, so they are never tokens.
      if (attribute(tag, "type").toLowerCase() !== "hidden") continue;
      this.note(attribute(tag, "name"), attribute(tag, "value"));
    }
    for (const tag of body.match(/<meta\b[^>]*>/gi) ?? []) {
      this.note(attribute(tag, "name"), attribute(tag, "content"));
    }
  }

  private recordJson(value: unknown, key: string): void {
    if (typeof value === "string") this.note(key, value);
    else if (Array.isArray(value)) for (const item of value) this.recordJson(item, key);
    else if (value !== null && typeof value === "object") {
      for (const [name, item] of Object.entries(value)) this.recordJson(item, name);
    }
  }

  /**
   * A name that was served with several values is a list of choices or records, not one token for
   * this load, so a value counts as served only when it is the only one the page gave that name.
   */
  has(name: string, value: string): boolean {
    const known = this.byName.get(name);
    return known?.size === 1 && known.has(value);
  }
}

function attribute(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return match ? (match[2] ?? match[3] ?? match[4] ?? "") : "";
}

function header(headers: Record<string, string> | undefined, name: string): string {
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (key.toLowerCase() === name) return value;
  }
  return "";
}

export function sha256(bytes: Buffer | null): string {
  return bytes === null || bytes.length === 0
    ? ""
    : createHash("sha256").update(bytes).digest("hex");
}

/** Reads the body of a paused request completely, or says it could not. */
export async function readBody(
  event: PausedRequest,
  fetchPostData: (requestId: string) => Promise<{ postData: string; base64Encoded?: boolean }>,
): Promise<BodyRead> {
  const { request } = event;
  const entries = request.postDataEntries;
  if (Array.isArray(entries) && entries.length > 0) {
    if (entries.some((entry) => typeof entry.bytes !== "string")) {
      return { bytes: null, present: true, unreadable: true };
    }
    const bytes = Buffer.concat(entries.map((entry) => Buffer.from(entry.bytes ?? "", "base64")));
    return { bytes, present: true, unreadable: bytes.length > MAX_BODY_BYTES };
  }
  if (typeof request.postData === "string") {
    const bytes = Buffer.from(request.postData, "utf8");
    return { bytes, present: true, unreadable: bytes.length > MAX_BODY_BYTES };
  }
  if (request.hasPostData !== true) return { bytes: null, present: false, unreadable: false };
  try {
    const answer = await fetchPostData(event.networkId ?? event.requestId);
    const bytes = Buffer.from(answer.postData, answer.base64Encoded ? "base64" : "utf8");
    return { bytes, present: true, unreadable: bytes.length > MAX_BODY_BYTES };
  } catch {
    return { bytes: null, present: true, unreadable: true };
  }
}

interface Leaf {
  path: string;
  value: string;
}

interface JsonLeaves {
  leaves: Leaf[];
  capped: boolean;
}

function jsonLeaves(value: unknown, path: string, out: JsonLeaves): void {
  if (out.leaves.length >= MAX_ENTRIES * 2) {
    out.capped = true;
    return;
  }
  const leaves = out.leaves;
  if (typeof value === "string") leaves.push({ path, value });
  else if (typeof value === "number" || typeof value === "boolean") {
    leaves.push({ path, value: String(value) });
  } else if (value === null) leaves.push({ path, value: "null" });
  else if (Array.isArray(value)) {
    value.forEach((item, index) => {
      jsonLeaves(item, `${path}[${index}]`, out);
    });
  } else if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      jsonLeaves(item, path === "" ? key : `${path}.${key}`, out);
    }
  }
}

function isPrintable(bytes: Buffer): boolean {
  const text = bytes.toString("utf8");
  if (text.includes("�")) return false;
  let odd = 0;
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 32 && code !== 9 && code !== 10 && code !== 13) odd += 1;
  }
  return odd / Math.max(1, text.length) <= 0.02;
}

function multipartLeaves(bytes: Buffer, boundary: string): Leaf[] | null {
  const text = bytes.toString("latin1");
  const parts = text.split(`--${boundary}`).slice(1);
  const leaves: Leaf[] = [];
  for (const part of parts) {
    if (part.startsWith("--")) break;
    const split = part.indexOf("\r\n\r\n");
    if (split < 0) return null;
    const head = part.slice(0, split);
    const content = Buffer.from(part.slice(split + 4).replace(/\r\n$/, ""), "latin1");
    const name = /name="([^"]*)"/i.exec(head)?.[1] ?? "";
    const file = /filename="([^"]*)"/i.exec(head)?.[1];
    leaves.push({
      path: name,
      value:
        file !== undefined ? `[file ${file}, ${content.length} bytes]` : content.toString("utf8"),
    });
  }
  return leaves;
}

interface Shaped {
  kind: OutgoingRequest["bodyKind"];
  leaves: Leaf[];
  /** The JSON held more leaves than are read. */
  capped?: boolean;
}

function shapeBody(body: BodyRead, contentType: string, encoding: string): Shaped {
  if (!body.present) return { kind: "none", leaves: [] };
  if (body.bytes === null || body.unreadable) return { kind: "opaque", leaves: [] };
  let plain: Buffer;
  try {
    plain = unpack(body.bytes, encoding);
  } catch {
    return { kind: "opaque", leaves: [] };
  }
  if (plain.length === 0) return { kind: "none", leaves: [] };
  const type = contentType.toLowerCase();
  if (type.includes("application/x-www-form-urlencoded")) {
    const leaves = [...new URLSearchParams(plain.toString("utf8"))].map(([path, value]) => ({
      path,
      value,
    }));
    return { kind: "form", leaves };
  }
  if (type.includes("multipart/form-data")) {
    const boundary = /boundary=("([^"]+)"|[^;\s]+)/i.exec(contentType);
    const name = boundary?.[2] ?? boundary?.[1];
    const leaves = name ? multipartLeaves(plain, name) : null;
    return leaves === null ? { kind: "opaque", leaves: [] } : { kind: "multipart", leaves };
  }
  if (!isPrintable(plain)) return { kind: "opaque", leaves: [] };
  const text = plain.toString("utf8");
  if (type.includes("json") || /^\s*[[{]/.test(text)) {
    try {
      const found: JsonLeaves = { leaves: [], capped: false };
      jsonLeaves(JSON.parse(text), "", found);
      return { kind: "json", leaves: found.leaves, capped: found.capped };
    } catch {
      // Not JSON after all: it is shown as the text it is.
    }
  }
  return { kind: "text", leaves: [{ path: "", value: text }] };
}

function lastKey(path: string): string {
  const key = path.replace(/\[\d+\]/g, "");
  return key.slice(key.lastIndexOf(".") + 1);
}

function clipText(text: string): string {
  return text.length > MAX_VALUE_CHARS ? text.slice(0, MAX_VALUE_CHARS) : text;
}

export interface CanonicalizeInput {
  event: PausedRequest;
  body: BodyRead;
  cookies: readonly Cookie[];
  target: TargetContext;
  party: "target" | "third";
  detector: ValueDetector;
  mask: (text: string) => string;
  served: ServedValues;
}

/**
 * Turns a paused request into the record a person reads and the server stores: where it goes, what
 * shape its body has, and each name and value in it with the person's own values replaced by their
 * placeholders. It also says what the request carries, whatever the packing.
 */
export function canonicalize(input: CanonicalizeInput): Canonical {
  const { event, body, cookies, target, party, detector, mask, served } = input;
  const url = new URL(event.request.url);
  const method = (event.request.method ?? "GET").toUpperCase();
  const headers = event.request.headers ?? {};
  const contentType = header(headers, "content-type");
  const encoding = header(headers, "content-encoding");

  let truncated = false;
  const clip = (text: string): string => {
    if (text.length > MAX_VALUE_CHARS) truncated = true;
    return clipText(text);
  };

  const carried = new Set<CarriedField>();
  const noteScan = (scan: Scan): Scan => {
    for (const field of scan.fields) carried.add(field);
    return scan;
  };

  const leafOf = (path: string, raw: string, scan: Scan): OutgoingValue => {
    const named = detector.scan([path]);
    if (named.fields.length > 0) {
      const hidden = mask(path);
      return {
        path: hidden === path ? `{{${named.fields.join("+")}}} (encoded)` : hidden,
        value: clip(mask(raw)),
        class: "profile",
        fields: [...new Set([...scan.fields, ...named.fields])].sort() as CarriedField[],
      };
    }
    if (scan.fields.length > 0) {
      const whole = detector.fieldOfWhole(raw);
      const masked = whole === null ? mask(raw) : `{{${whole}}}`;
      const shown = masked === raw ? `{{${scan.fields.join("+")}}} (encoded)` : masked;
      return { path, value: clip(shown), class: "profile", fields: scan.fields };
    }
    const name = lastKey(path);
    if (served.has(name, raw)) return { path, value: clip(raw), class: "served_token" };
    return { path, value: clip(mask(raw)), class: "literal" };
  };

  const scanEach = (leaves: readonly Leaf[]): OutgoingValue[] => {
    if (leaves.length > MAX_ENTRIES) truncated = true;
    return leaves
      .slice(0, MAX_ENTRIES)
      .map((leaf) =>
        leafOf(leaf.path, leaf.value, noteScan(detector.scan([leaf.path, leaf.value]))),
      );
  };

  const query = scanEach([...url.searchParams].map(([path, value]) => ({ path, value })));
  const searchScan = noteScan(detector.scan([url.search, safeDecode(url.search)]));
  const segments = url.pathname.split("/").filter((segment) => segment !== "");
  const pathScan = noteScan(
    detector.scan([...segments.map((segment) => safeDecode(segment)), url.pathname]),
  );
  const pathShown = url.pathname
    .split("/")
    .map((segment) => {
      const masked = mask(segment);
      if (masked !== segment || segment === "") return masked;
      const found = detector.scan([safeDecode(segment), segment]).fields;
      return found.length > 0 ? `{{${found.join("+")}}} (encoded)` : segment;
    })
    .join("/");
  const hostScan = noteScan(detector.scan([url.hostname]));

  const shaped = shapeBody(body, contentType, encoding);
  const bodyValues = scanEach(shaped.leaves);
  if (shaped.capped === true) truncated = true;
  const rawBody: (string | { data: Buffer; contentEncoding?: string })[] =
    body.bytes === null
      ? []
      : [{ data: body.bytes, ...(encoding === "" ? {} : { contentEncoding: encoding }) }];
  const rawScan = noteScan(detector.scan(rawBody));

  const headerValues: OutgoingValue[] = [];
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (lower === "cookie" || (lower === "referer" && party === "target")) continue;
    if (headerValues.length >= MAX_HEADERS) {
      truncated = true;
      break;
    }
    const scan = noteScan(detector.scan([lower, value]));
    if (scan.fields.length > 0) headerValues.push(leafOf(lower, value, scan));
  }
  for (const cookie of cookies) {
    if (headerValues.length >= MAX_HEADERS) {
      truncated = true;
      break;
    }
    const scan = noteScan(detector.scan([cookie.name, cookie.value]));
    if (scan.fields.length > 0)
      headerValues.push(leafOf(`cookie:${cookie.name}`, cookie.value, scan));
  }

  const hostMasked = mask(url.host);
  const hostShown =
    hostScan.fields.length > 0 && hostMasked === url.host
      ? `{{${hostScan.fields.join("+")}}} (encoded)`
      : hostMasked;

  const fields = [...carried].sort();
  const overflow =
    rawScan.overflow || pathScan.overflow || hostScan.overflow || searchScan.overflow;
  const request: OutgoingRequest = {
    method,
    scheme: url.protocol.replace(":", ""),
    host: hostShown,
    path: clip(mask(pathShown)),
    resourceType: event.resourceType,
    isDocument: event.resourceType === "Document",
    target,
    party,
    bodyKind: shaped.kind,
    query,
    body: bodyValues,
    headers: headerValues,
    bodyBytes: body.bytes?.length ?? 0,
    bodyDigest: sha256(body.bytes),
    carries: fields,
  };
  const scan: Scan = {
    fields,
    contact: fields.some((field) => isContactField(field)),
    lookup: fields.some((field) => !isContactField(field)),
    overflow,
  };
  return { request, scan, body, method, url: event.request.url, truncated };
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
