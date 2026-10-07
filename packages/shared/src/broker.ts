import { z } from "zod";

export const BrokerCategory = z.enum([
  "people-search",
  "marketing",
  "background-check",
  "financial-b2b",
  "device-id-only",
  "requires-id",
  "registered-broker",
]);
export type BrokerCategory = z.infer<typeof BrokerCategory>;

export const ContactMethod = z.enum(["email", "form", "both", "unknown"]);
export type ContactMethod = z.infer<typeof ContactMethod>;

export const DataSourceId = z.enum([
  "eraser",
  "ca-registry-2025",
  "badbool",
  "kickrocks",
  "kickrocks-companies",
]);
export type DataSourceId = z.infer<typeof DataSourceId>;

export const DataSource = z.object({
  source: DataSourceId,
  license: z.enum(["MIT", "public-record", "CC-BY-NC-SA-4.0", "PolyForm-Noncommercial-1.0.0"]),
  upstreamId: z.string().optional(),
});
export type DataSource = z.infer<typeof DataSource>;

/** What a broker makes a person do beyond sending a request. */
export const Requirement = z.enum([
  "email_confirmation",
  "phone_call",
  "id_upload",
  "captcha",
  "account",
  "paid",
  "record_url",
  "postal_mail",
  "fax",
]);
export type Requirement = z.infer<typeof Requirement>;

export const TargetPriority = z.enum(["crucial", "high", "normal"]);
export type TargetPriority = z.infer<typeof TargetPriority>;

export const RegulatoryRegime = z.enum(["fcra", "glba", "iippa", "cmia", "hipaa"]);
export type RegulatoryRegime = z.infer<typeof RegulatoryRegime>;

export const RequestMetrics = z.object({
  year: z.number().int(),
  deleteReceived: z.number().int().nullable(),
  deleteCompliedWhole: z.number().int().nullable(),
  deleteDenied: z.number().int().nullable(),
  deleteMedianDays: z.number().nullable(),
  optOutReceived: z.number().int().nullable(),
  optOutCompliedWhole: z.number().int().nullable(),
  optOutDenied: z.number().int().nullable(),
  optOutMedianDays: z.number().nullable(),
});
export type RequestMetrics = z.infer<typeof RequestMetrics>;

export const Broker = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  category: BrokerCategory,
  website: z.url().nullable(),
  domain: z.string().min(1),
  privacyEmail: z.email().nullable(),
  optOutUrl: z.url().nullable(),
  privacyRightsUrl: z.url().nullable(),
  /** Where a person finds their own record, for sites that need a record URL to remove it. */
  searchUrl: z.url().nullable(),
  contactMethod: ContactMethod,
  region: z.enum(["us", "eu", "global"]),
  requiresId: z.boolean(),
  requirements: z.array(Requirement),
  priority: TargetPriority,
  regulatedBy: z.array(RegulatoryRegime),
  collectsMinors: z.boolean().nullable(),
  collectsGeolocation: z.boolean().nullable(),
  collectsReproductiveHealth: z.boolean().nullable(),
  metrics: RequestMetrics.nullable(),
  notes: z.string().nullable(),
  sources: z.array(DataSource).min(1),
});
export type Broker = z.infer<typeof Broker>;

export const BrokerDataset = z.object({
  generatedAt: z.iso.datetime(),
  brokers: z.array(Broker),
});
export type BrokerDataset = z.infer<typeof BrokerDataset>;

export function contactMethodFor(
  privacyEmail: string | null,
  optOutUrl: string | null,
): ContactMethod {
  if (privacyEmail && optOutUrl) return "both";
  if (privacyEmail) return "email";
  if (optOutUrl) return "form";
  return "unknown";
}

/** Strips scheme, credentials, port, path, and a leading www so two records for one site collide. */
export function normalizeDomain(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const host = new URL(withScheme).hostname.toLowerCase();
    return host.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
