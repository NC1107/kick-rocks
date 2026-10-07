import {
  type Broker,
  contactMethodFor,
  normalizeDomain,
  type RegulatoryRegime,
  slugify,
  WebUrl,
} from "@kickrocks/shared";
import { parse } from "csv-parse/sync";
import { z } from "zod";

/**
 * Column positions in the CPPA registry export. The file has two header rows:
 * the first holds publishing notes, the second holds the question text.
 */
const COL = {
  name: 0,
  dba: 1,
  website: 2,
  email: 3,
  collectsMinors: 11,
  collectsGeolocation: 12,
  collectsReproductiveHealth: 13,
  privacyRightsUrl: 14,
  fcra: 15,
  glba: 19,
  iippa: 23,
  cmia: 27,
  hipaa: 31,
  deleteReceived: 35,
  deleteCompliedWhole: 36,
  deleteDenied: 38,
  deleteMedianDays: 39,
  optOutReceived: 53,
  optOutCompliedWhole: 54,
  optOutDenied: 56,
  optOutMedianDays: 57,
} as const;

const HEADER_ROWS = 2;
const METRICS_YEAR = 2023;

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

function regimes(row: readonly string[]): RegulatoryRegime[] {
  const out: RegulatoryRegime[] = [];
  if (yesNo(cell(row, COL.fcra))) out.push("fcra");
  if (yesNo(cell(row, COL.glba))) out.push("glba");
  if (yesNo(cell(row, COL.iippa))) out.push("iippa");
  if (yesNo(cell(row, COL.cmia))) out.push("cmia");
  if (yesNo(cell(row, COL.hipaa))) out.push("hipaa");
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
  const brokers: Broker[] = [];
  const seenIds = new Set<string>();
  for (const row of rows.slice(HEADER_ROWS)) {
    const name = cell(row, COL.name);
    if (!name) continue;
    const websites = webUrls(cell(row, COL.website));
    const website = websites[0] ?? null;
    const privacyRightsUrl = urlOrNull(cell(row, COL.privacyRightsUrl));
    const privacyEmail = emailOrNull(cell(row, COL.email));
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
      contactMethod: contactMethodFor(privacyEmail, privacyRightsUrl),
      region: "us",
      requiresId: false,
      requirements: [],
      priority: "normal",
      regulatedBy: regimes(row),
      collectsMinors: yesNo(cell(row, COL.collectsMinors)),
      collectsGeolocation: yesNo(cell(row, COL.collectsGeolocation)),
      collectsReproductiveHealth: yesNo(cell(row, COL.collectsReproductiveHealth)),
      metrics: {
        year: METRICS_YEAR,
        deleteReceived: intOrNull(cell(row, COL.deleteReceived)),
        deleteCompliedWhole: intOrNull(cell(row, COL.deleteCompliedWhole)),
        deleteDenied: intOrNull(cell(row, COL.deleteDenied)),
        deleteMedianDays: numberOrNull(cell(row, COL.deleteMedianDays)),
        optOutReceived: intOrNull(cell(row, COL.optOutReceived)),
        optOutCompliedWhole: intOrNull(cell(row, COL.optOutCompliedWhole)),
        optOutDenied: intOrNull(cell(row, COL.optOutDenied)),
        optOutMedianDays: numberOrNull(cell(row, COL.optOutMedianDays)),
      },
      notes: noteFor(cell(row, COL.dba), websites.slice(1)),
      sources: [{ source: "ca-registry-2025", license: "public-record", upstreamId: name }],
    });
  }
  return brokers;
}
