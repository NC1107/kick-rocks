import {
  type Broker,
  contactMethodFor,
  normalizeDomain,
  type RegulatoryRegime,
  rightsPageAsForm,
  slugify,
  WebUrl,
} from "@kickrocks/shared";
import { parse } from "csv-parse/sync";
import { z } from "zod";

const DELETE = "requests to delete";
const OPT_OUT = "requests to opt out of sale or sharing";

/**
 * The registry export changes its column count and order between years, so columns are found by
 * their header text. Each entry matches the normalized header of exactly one column.
 */
const COLUMN_MATCHERS = {
  name: (h: string) => h === "data broker name:",
  dba: (h: string) => h.startsWith("doing business as"),
  website: (h: string) => h === "data broker primary website:",
  email: (h: string) => h.startsWith("data broker primary contact email"),
  privacyRightsUrl: (h: string) => h.startsWith("data broker's primary website that contains"),
  collectsMinors: (h: string) => h.includes("collects personal information of minors"),
  collectsGeolocation: (h: string) => h.includes("collects consumers' precise geolocation"),
  collectsReproductiveHealth: (h: string) => h.includes("collects consumers' reproductive health"),
  fcra: (h: string) => regulatedBy(h, "federal fair credit reporting act"),
  glba: (h: string) => regulatedBy(h, "gramm-leach-bliley act"),
  iippa: (h: string) => regulatedBy(h, "insurance information and privacy protection act"),
  cmia: (h: string) => regulatedBy(h, "confidentiality of medical information act"),
  hipaa: (h: string) => regulatedBy(h, "hipaa privacy"),
  deleteReceived: (h: string) => h === "requests to delete - total requests received",
  deleteCompliedWhole: (h: string) =>
    h === `${DELETE} - total requests received - complied in whole`,
  deleteDenied: (h: string) => h === `${DELETE} - total requests received - denied`,
  deleteMedianDays: (h: string) =>
    h.startsWith(`${DELETE} - the number of days`) && h.endsWith("median"),
  optOutReceived: (h: string) => h === `${OPT_OUT} - total requests received`,
  optOutCompliedWhole: (h: string) =>
    h === `${OPT_OUT} - total requests received - complied in whole`,
  optOutDenied: (h: string) => h === `${OPT_OUT} - total requests received - denied`,
  optOutMedianDays: (h: string) =>
    h.startsWith(`${OPT_OUT} - the number of days`) && h.endsWith("median"),
} as const;

type ColumnName = keyof typeof COLUMN_MATCHERS;
type Columns = Record<ColumnName, number>;

/** The regime question itself, not the "if regulated, describe ..." follow-ups under it. */
function regulatedBy(header: string, law: string): boolean {
  return !header.startsWith("if ") && header.includes("regulated by") && header.includes(law);
}

function normalizeHeader(header: string): string {
  return header
    .replace(/^\uFEFF/, "")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function locateColumns(header: readonly string[]): Columns {
  const normalized = header.map(normalizeHeader);
  const columns = {} as Columns;
  for (const name of Object.keys(COLUMN_MATCHERS) as ColumnName[]) {
    const index = normalized.findIndex(COLUMN_MATCHERS[name]);
    if (index === -1) throw new Error(`The California registry has no column for ${name}`);
    columns[name] = index;
  }
  return columns;
}

/** The reporting year is stated in the header of the response-time columns, as "... in 2024 - Median". */
function metricsYear(header: readonly string[], column: number): number {
  const year = /\bin (\d{4})\b/.exec(header[column] ?? "")?.[1];
  if (!year) throw new Error("The California registry does not say which year its metrics cover");
  return Number(year);
}

function cell(row: readonly string[], index: number): string {
  return (row[index] ?? "").trim();
}

function yesNo(value: string): boolean | null {
  const v = value.toLowerCase();
  if (v === "yes") return true;
  if (v === "no") return false;
  return null;
}

function numberOrNull(value: string): number | null {
  if (!value) return null;
  const cleaned = value.replace(/[,\s]/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(cleaned)) return null;
  return Number(cleaned);
}

function intOrNull(value: string): number | null {
  const n = numberOrNull(value);
  return n === null ? null : Math.trunc(n);
}

function asWebUrl(value: string): string | null {
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(value) ? value : `https://${value}`;
  return WebUrl.safeParse(candidate).success ? candidate : null;
}

/**
 * Brokers list several sites in one cell, separated by semicolons and line breaks, so the cell is
 * split before anything reads a domain from it. The first usable address is the broker's own.
 */
function webUrls(value: string): string[] {
  return value
    .split(/[;\s]+/)
    .filter(Boolean)
    .map(asWebUrl)
    .filter((url): url is string => url !== null);
}

function urlOrNull(value: string): string | null {
  return webUrls(value)[0] ?? null;
}

function emailOrNull(value: string): string | null {
  if (!value) return null;
  const first = value.split(/[;,\s]+/)[0] ?? "";
  return z.email().safeParse(first).success ? first : null;
}

function regimes(row: readonly string[], col: Columns): RegulatoryRegime[] {
  const out: RegulatoryRegime[] = [];
  if (yesNo(cell(row, col.fcra))) out.push("fcra");
  if (yesNo(cell(row, col.glba))) out.push("glba");
  if (yesNo(cell(row, col.iippa))) out.push("iippa");
  if (yesNo(cell(row, col.cmia))) out.push("cmia");
  if (yesNo(cell(row, col.hipaa))) out.push("hipaa");
  return out;
}

function noteFor(dba: string, otherSites: readonly string[]): string | null {
  const parts = [
    dba ? `DBA: ${dba}` : null,
    otherSites.length > 0 ? `Other sites: ${otherSites.join(", ")}` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" | ") : null;
}

export function parseCaRegistry(csvText: string): Broker[] {
  const rows = parse(csvText, {
    bom: true,
    relax_column_count: true,
    skip_empty_lines: true,
  }) as string[][];
  const header = rows[0];
  if (!header) throw new Error("The California registry is empty");
  const col = locateColumns(header);
  const year = metricsYear(header, col.deleteMedianDays);
  const brokers: Broker[] = [];
  const seenIds = new Set<string>();
  for (const row of rows.slice(1)) {
    const name = cell(row, col.name);
    if (!name) continue;
    const websites = webUrls(cell(row, col.website));
    const website = websites[0] ?? null;
    const privacyRightsUrl = urlOrNull(cell(row, col.privacyRightsUrl));
    const privacyEmail = emailOrNull(cell(row, col.email));
    const domain =
      (website && normalizeDomain(website)) ??
      (privacyRightsUrl && normalizeDomain(privacyRightsUrl)) ??
      (privacyEmail ? normalizeDomain(privacyEmail.split("@")[1] ?? "") : null);
    if (!domain) continue;
    let id = slugify(name);
    if (!id) id = slugify(domain);
    if (seenIds.has(id)) id = `${id}-${slugify(domain)}`;
    seenIds.add(id);
    brokers.push({
      id,
      name,
      category: "registered-broker",
      website,
      domain,
      privacyEmail,
      optOutUrl: null,
      privacyRightsUrl,
      searchUrl: null,
      contactMethod: contactMethodFor(privacyEmail, rightsPageAsForm(privacyRightsUrl)),
      region: "us",
      requiresId: false,
      requirements: [],
      priority: "normal",
      regulatedBy: regimes(row, col),
      collectsMinors: yesNo(cell(row, col.collectsMinors)),
      collectsGeolocation: yesNo(cell(row, col.collectsGeolocation)),
      collectsReproductiveHealth: yesNo(cell(row, col.collectsReproductiveHealth)),
      metrics: {
        year,
        deleteReceived: intOrNull(cell(row, col.deleteReceived)),
        deleteCompliedWhole: intOrNull(cell(row, col.deleteCompliedWhole)),
        deleteDenied: intOrNull(cell(row, col.deleteDenied)),
        deleteMedianDays: numberOrNull(cell(row, col.deleteMedianDays)),
        optOutReceived: intOrNull(cell(row, col.optOutReceived)),
        optOutCompliedWhole: intOrNull(cell(row, col.optOutCompliedWhole)),
        optOutDenied: intOrNull(cell(row, col.optOutDenied)),
        optOutMedianDays: numberOrNull(cell(row, col.optOutMedianDays)),
      },
      notes: noteFor(cell(row, col.dba), websites.slice(1)),
      sources: [{ source: "ca-registry-2026", license: "public-record", upstreamId: name }],
    });
  }
  return brokers;
}
