import { z } from "zod";
import {
  BrokerCategory,
  ContactMethod,
  DataSource,
  Requirement,
  TargetPriority,
} from "./broker.js";
import { RecipeHealth, RecipePurpose, RecipeSource, RecipeStatus } from "./recipe.js";
import { WebUrl } from "./url.js";

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
  optOutUrl: WebUrl.nullable(),
  privacyRightsUrl: WebUrl.nullable(),
  contactMethod: ContactMethod,
  notes: z.string().nullable(),
  sources: z.array(DataSource).min(1),
  /** The day someone checked these contacts against the company's own privacy page. */
  verifiedAt: z.iso.date(),
});
export type Company = z.infer<typeof Company>;

/** The company list is written by hand for this project, so it carries the project's own license. */
export const COMPANY_DATASET_LICENSE = "PolyForm-Noncommercial-1.0.0";

export const CompanyDataset = z.object({
  generatedAt: z.iso.datetime(),
  license: z.literal(COMPANY_DATASET_LICENSE),
  companies: z.array(Company),
});
export type CompanyDataset = z.infer<typeof CompanyDataset>;

const PEOPLE_SEARCH_LIKE: ReadonlySet<TargetCategory> = new Set([
  "people-search",
  "background-check",
]);

/**
 * Targets in a people-search category that remove a person from identifiers alone, so no record
 * URL is needed. Add an id only after reading its opt-out page; the default is that a listing has
 * to be found first.
 */
export const RECORD_NOT_NEEDED: ReadonlySet<string> = new Set();

/**
 * People-search and background-check sites cannot remove a record they cannot locate, so a
 * removal there starts from a scan that finds the record URL instead of a blind request.
 * The category decides, not a requirement flag in the dataset, because a flag that one import
 * forgets to set would quietly turn every one of these sites into a blind form request.
 */
export function needsRecord(target: { id: string; category: TargetCategory }): boolean {
  return PEOPLE_SEARCH_LIKE.has(target.category) && !RECORD_NOT_NEEDED.has(target.id);
}

/** What lists, claims, and agents need to know about a target. Contains no personal data. */
export const TargetSummary = z.object({
  id: z.string(),
  kind: TargetKind,
  name: z.string(),
  category: TargetCategory,
  domain: z.string(),
  website: WebUrl.nullable(),
  /** Where to opt out, so an agent does not need a second call to find the page. */
  optOutUrl: WebUrl.nullable(),
  /** The page for asking a company to delete a person's data, which is not the same as its opt-out page. */
  privacyRightsUrl: WebUrl.nullable(),
  /** Where a person finds their own record, for sites that remove a specific record. */
  searchUrl: WebUrl.nullable(),
  contactMethod: ContactMethod,
  requiresId: z.boolean(),
  requirements: z.array(Requirement),
  priority: TargetPriority,
  needsRecord: z.boolean(),
  /** Listed in California's data broker registry, which decides whether the Delete Act covers a request. */
  californiaRegistered: z.boolean(),
  /** The dataset no longer lists it. Nothing new is sent to it, but its history stays. */
  retired: z.boolean(),
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

/** What automation exists for a target: the health of its newest active recipe, or null when it has none. */
export const TargetAutomation = z.object({
  scan: RecipeHealth.nullable(),
  remove: RecipeHealth.nullable(),
});
export type TargetAutomation = z.infer<typeof TargetAutomation>;

/** A row of the targets list, which shows which targets are automated without a call per row. */
export const TargetListItem = TargetSummary.extend({ automation: TargetAutomation });
export type TargetListItem = z.infer<typeof TargetListItem>;

export const TargetDetail = TargetSummary.extend({
  privacyEmail: z.email().nullable(),
  region: z.enum(["us", "eu", "global"]),
  notes: z.string().nullable(),
  sources: z.array(DataSource),
  verifiedAt: z.iso.date().nullable(),
  recipes: z.array(TargetRecipe),
});
export type TargetDetail = z.infer<typeof TargetDetail>;
