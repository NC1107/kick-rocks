import { z } from "zod";
import {
  BrokerCategory,
  ContactMethod,
  DataSource,
  Requirement,
  TargetPriority,
} from "./broker.js";
import { RecipeHealth, RecipePurpose, RecipeSource, RecipeStatus } from "./recipe.js";

export const TargetKind = z.enum(["broker", "company"]);
export type TargetKind = z.infer<typeof TargetKind>;

export const CompanyCategory = z.enum([
  "retail",
  "finance",
  "telecom",
  "tech",
  "media",
  "travel",
  "auto",
  "health",
  "other",
]);
export type CompanyCategory = z.infer<typeof CompanyCategory>;

/** Broker and company categories never overlap, so one flat enum can describe either. */
export const TargetCategory = z.enum([...BrokerCategory.options, ...CompanyCategory.options]);
export type TargetCategory = z.infer<typeof TargetCategory>;

/** An ordinary consumer company asked to stop selling or sharing a person's data. */
export const Company = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  domain: z.string().min(1),
  category: CompanyCategory,
  privacyEmail: z.email().nullable(),
  optOutUrl: z.url().nullable(),
  privacyRightsUrl: z.url().nullable(),
  contactMethod: ContactMethod,
  notes: z.string().nullable(),
  sources: z.array(DataSource).min(1),
  /** The day someone checked these contacts against the company's own privacy page. */
  verifiedAt: z.iso.date(),
});
export type Company = z.infer<typeof Company>;

export const CompanyDataset = z.object({
  generatedAt: z.iso.datetime(),
  companies: z.array(Company),
});
export type CompanyDataset = z.infer<typeof CompanyDataset>;

const PEOPLE_SEARCH_LIKE: ReadonlySet<TargetCategory> = new Set([
  "people-search",
  "background-check",
]);

/**
 * People-search and background-check sites cannot remove a record they cannot locate, so a
 * removal there starts from a scan that finds the record URL instead of a blind request.
 */
export function needsRecord(target: {
  category: TargetCategory;
  requirements: readonly Requirement[];
}): boolean {
  return PEOPLE_SEARCH_LIKE.has(target.category) && target.requirements.includes("record_url");
}

/** What lists, claims, and agents need to know about a target. Contains no personal data. */
export const TargetSummary = z.object({
  id: z.string(),
  kind: TargetKind,
  name: z.string(),
  category: TargetCategory,
  domain: z.string(),
  website: z.url().nullable(),
  contactMethod: ContactMethod,
  requiresId: z.boolean(),
  requirements: z.array(Requirement),
  priority: TargetPriority,
  needsRecord: z.boolean(),
});
export type TargetSummary = z.infer<typeof TargetSummary>;

/** A recipe as shown next to a target: enough to know what automation exists and whether to trust it. */
export const TargetRecipe = z.object({
  id: z.string(),
  purpose: RecipePurpose,
  version: z.number().int().positive(),
  source: RecipeSource,
  status: RecipeStatus,
  health: RecipeHealth,
});
export type TargetRecipe = z.infer<typeof TargetRecipe>;

export const TargetDetail = TargetSummary.extend({
  privacyEmail: z.email().nullable(),
  optOutUrl: z.url().nullable(),
  privacyRightsUrl: z.url().nullable(),
  searchUrl: z.url().nullable(),
  region: z.enum(["us", "eu", "global"]),
  notes: z.string().nullable(),
  sources: z.array(DataSource),
  verifiedAt: z.iso.date().nullable(),
  recipes: z.array(TargetRecipe),
});
export type TargetDetail = z.infer<typeof TargetDetail>;
