import { z } from "zod";
import { isSharedMailHost } from "./mail-hosts.js";
import { WebUrl } from "./url.js";

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

/** "ca-registry-2025" is no longer imported, but targets that left the dataset keep it in their stored sources. */
export const DataSourceId = z.enum([
  "eraser",
  "ca-registry-2025",
  "ca-registry-2026",
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

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

/**
 * Extra domains a target's replies and confirmation emails may come from, for sister domains that
 * none of the contact fields reveal. Curated by hand, and never a shared mail host.
 */
export const ReplyDomains = z.array(
  z
    .string()
    .regex(HOSTNAME)
    .refine((host) => !isSharedMailHost(host), "a shared mail host cannot vouch for a target"),
);
export type ReplyDomains = z.infer<typeof ReplyDomains>;

/**
 * The lead domain of the sites one operator runs behind the same infrastructure and bot defences.
 * Politeness counts a visit to any of them as a visit to all, so the key must be the same on every
 * member of the group.
 */
export const OwnerGroup = z.string().regex(HOSTNAME);
export type OwnerGroup = z.infer<typeof OwnerGroup>;

export const Broker = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  category: BrokerCategory,
  website: WebUrl.nullable(),
  domain: z.string().min(1),
  privacyEmail: z.email().nullable(),
  optOutUrl: WebUrl.nullable(),
  privacyRightsUrl: WebUrl.nullable(),
  /** Where a person finds their own record, for sites that need a record URL to remove it. */
  searchUrl: WebUrl.nullable(),
  contactMethod: ContactMethod,
  region: z.enum(["us", "eu", "global"]),
  requiresId: z.boolean(),
  requirements: z.array(Requirement),
  priority: TargetPriority,
  /** Curated sister domains the broker's confirmation emails come from; see {@link ReplyDomains}. */
  replyDomains: ReplyDomains.optional(),
  /** Curated: the operator this site shares a network with; see {@link OwnerGroup}. */
  ownerGroup: OwnerGroup.optional(),
  regulatedBy: z.array(RegulatoryRegime),
  collectsMinors: z.boolean().nullable(),
  collectsGeolocation: z.boolean().nullable(),
  collectsReproductiveHealth: z.boolean().nullable(),
  metrics: RequestMetrics.nullable(),
  notes: z.string().nullable(),
  sources: z.array(DataSource).min(1),
});
export type Broker = z.infer<typeof Broker>;

/** The license the generated broker file is distributed under, because BADBOOL's ShareAlike clause covers the whole file. */
export const BROKER_DATASET_LICENSE = "CC-BY-NC-SA-4.0";

/** Credit that has to travel with the generated file wherever it goes. */
export const BROKER_DATASET_ATTRIBUTION =
  "Contains data from the Big Ass Data Broker Opt-Out List by Yael Grauer (CC BY-NC-SA 4.0), the Eraser broker list (MIT), and the California Data Broker Registry (public record).";

export const BrokerDataset = z.object({
  generatedAt: z.iso.datetime(),
  license: z.literal(BROKER_DATASET_LICENSE),
  attribution: z.string().min(1),
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

/**
 * A registry lists a rights page for every broker, and some give their front page. That is where a
 * visitor starts looking, not a form that takes a request, so it must not make the target a form.
 */
export function rightsPageAsForm(url: string | null): string | null {
  if (!url) return null;
  try {
    const { pathname, search, hash } = new URL(url);
    return pathname === "/" && search === "" && hash === "" ? null : url;
  } catch {
    return url;
  }
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
