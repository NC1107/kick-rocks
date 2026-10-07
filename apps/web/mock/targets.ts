import {
  API_ROUTES,
  type BrokerCategory,
  type CompanyCategory,
  type ContactMethod,
  needsRecord,
  type Requirement,
  slugify,
  type TargetDetail,
  type TargetFacets,
  type TargetListItem,
  type TargetPriority,
  type TargetRecipe,
  type TargetSummary,
} from "@kickrocks/shared";
import { defineMockDomain, handle, notFound } from "./core.js";

/*
 * Fictional brokers and companies on the reserved .example domain: nothing here names a real
 * business, so a screenshot cannot be read as a claim about one.
 */

interface BrokerSeed {
  name: string;
  category: BrokerCategory;
  contact: ContactMethod;
  priority: TargetPriority;
  requirements?: Requirement[];
  notes?: string;
  recipes?: TargetRecipe["health"][];
}

const BROKERS: BrokerSeed[] = [
  {
    name: "PeopleTrace",
    category: "people-search",
    contact: "form",
    priority: "crucial",
    requirements: ["record_url", "email_confirmation"],
    recipes: ["healthy", "healthy"],
    notes: "Needs the URL of your own record. The removal form emails a confirmation link.",
  },
  {
    name: "FindRecord",
    category: "people-search",
    contact: "form",
    priority: "crucial",
    requirements: ["record_url", "captcha"],
    recipes: ["healthy", "broken"],
    notes: "Shows a CAPTCHA before the form submits.",
  },
  {
    name: "NameLookup",
    category: "people-search",
    contact: "both",
    priority: "crucial",
    requirements: ["record_url"],
    recipes: ["healthy", "unknown"],
  },
  {
    name: "Cityfile Directory",
    category: "people-search",
    contact: "form",
    priority: "high",
    requirements: ["record_url", "email_confirmation"],
    recipes: ["unknown", "unknown"],
  },
  {
    name: "HomeRecords",
    category: "people-search",
    contact: "form",
    priority: "high",
    requirements: ["record_url", "phone_call"],
    notes: "Removal needs a phone call to a verification line.",
  },
  {
    name: "Locata",
    category: "people-search",
    contact: "form",
    priority: "high",
    requirements: ["record_url", "captcha"],
  },
  {
    name: "OpenRoster",
    category: "people-search",
    contact: "email",
    priority: "normal",
    requirements: [],
  },
  {
    name: "KinSearch",
    category: "people-search",
    contact: "form",
    priority: "normal",
    requirements: ["record_url", "account"],
    notes: "Asks you to create a free account before it lets you remove a record.",
  },
  {
    name: "AddressBook Index",
    category: "people-search",
    contact: "form",
    priority: "normal",
    requirements: ["record_url"],
  },
  {
    name: "Whereabout",
    category: "people-search",
    contact: "both",
    priority: "normal",
    requirements: ["record_url", "email_confirmation"],
  },
  {
    name: "ClearCheck",
    category: "background-check",
    contact: "form",
    priority: "crucial",
    requirements: ["record_url", "id_upload"],
    notes: "Lists records by city, so a person with several addresses can match more than once.",
  },
  {
    name: "VerifyFirst",
    category: "background-check",
    contact: "form",
    priority: "high",
    requirements: ["record_url", "captcha", "email_confirmation"],
  },
  {
    name: "BackgroundBay",
    category: "background-check",
    contact: "both",
    priority: "normal",
    requirements: ["record_url"],
  },
  {
    name: "AudienceGrid",
    category: "marketing",
    contact: "email",
    priority: "high",
    requirements: [],
  },
  {
    name: "Lumen Data Partners",
    category: "marketing",
    contact: "email",
    priority: "high",
    requirements: [],
  },
  {
    name: "Brightlist",
    category: "marketing",
    contact: "both",
    priority: "normal",
    requirements: ["email_confirmation"],
  },
  {
    name: "Cardinal Insights",
    category: "marketing",
    contact: "email",
    priority: "normal",
    requirements: [],
  },
  {
    name: "Meridian Marketing Data",
    category: "marketing",
    contact: "form",
    priority: "normal",
    requirements: ["captcha"],
  },
  {
    name: "TrueSegment",
    category: "marketing",
    contact: "email",
    priority: "normal",
    requirements: [],
  },
  {
    name: "Harbor Consumer Data",
    category: "marketing",
    contact: "email",
    priority: "normal",
    requirements: ["postal_mail"],
    notes: "Accepts opt-outs by post only after the email is ignored.",
  },
  {
    name: "Quill Analytics",
    category: "marketing",
    contact: "unknown",
    priority: "normal",
    requirements: [],
    notes: "No working contact method on file.",
  },
  {
    name: "LedgerPoint",
    category: "financial-b2b",
    contact: "email",
    priority: "normal",
    requirements: [],
  },
  {
    name: "CreditLens Data",
    category: "financial-b2b",
    contact: "both",
    priority: "high",
    requirements: ["id_upload"],
  },
  {
    name: "AdSignal",
    category: "device-id-only",
    contact: "form",
    priority: "normal",
    requirements: [],
  },
  {
    name: "PixelGraph",
    category: "device-id-only",
    contact: "form",
    priority: "normal",
    requirements: [],
  },
  {
    name: "RecordVault",
    category: "requires-id",
    contact: "email",
    priority: "normal",
    requirements: ["id_upload"],
  },
  {
    name: "Ashford Data Services",
    category: "registered-broker",
    contact: "email",
    priority: "normal",
    requirements: [],
  },
  {
    name: "Pinecrest Information",
    category: "registered-broker",
    contact: "both",
    priority: "normal",
    requirements: [],
  },
  {
    name: "Redwood Registered Data",
    category: "registered-broker",
    contact: "email",
    priority: "normal",
    requirements: [],
    notes: "Listed in the California registry.",
  },
];

interface CompanySeed {
  name: string;
  category: CompanyCategory;
  contact: ContactMethod;
}

const COMPANIES: CompanySeed[] = [
  { name: "Alder & Finch", category: "retail", contact: "both" },
  { name: "Corner Basket Market", category: "retail", contact: "email" },
  { name: "Hearth and Hammer", category: "retail", contact: "form" },
  { name: "Greenhouse Outfitters", category: "retail", contact: "email" },
  { name: "Larkspur Bank", category: "finance", contact: "form" },
  { name: "Tidewater Card Services", category: "finance", contact: "both" },
  { name: "Summit Mutual", category: "finance", contact: "email" },
  { name: "Brightline Mobile", category: "telecom", contact: "form" },
  { name: "Northgate Wireless", category: "telecom", contact: "email" },
  { name: "SkyFiber", category: "telecom", contact: "both" },
  { name: "Orbit Mail", category: "tech", contact: "form" },
  { name: "Cloudhaven", category: "tech", contact: "both" },
  { name: "Pixelforge", category: "tech", contact: "email" },
  { name: "Quillnote", category: "tech", contact: "form" },
  { name: "Daily Harbor News", category: "media", contact: "email" },
  { name: "StreamNest", category: "media", contact: "both" },
  { name: "Lantern Audio", category: "media", contact: "form" },
  { name: "Waypoint Airlines", category: "travel", contact: "both" },
  { name: "Stayfield Hotels", category: "travel", contact: "email" },
  { name: "RoamRentals", category: "travel", contact: "form" },
  { name: "Driftwood Motors", category: "auto", contact: "email" },
  { name: "Torque Auto Insurance", category: "auto", contact: "both" },
  { name: "Wellspring Pharmacy", category: "health", contact: "form" },
  { name: "VitalTrack", category: "health", contact: "email" },
  { name: "Pawprint Pet Supply", category: "other", contact: "email" },
  { name: "Greenway Utilities", category: "other", contact: "unknown" },
  { name: "Maplewood Cinemas", category: "media", contact: "email" },
  { name: "Cobalt Fitness", category: "health", contact: "both" },
  { name: "Juniper Home Goods", category: "retail", contact: "email" },
  { name: "Ferry Street Coffee", category: "retail", contact: "form" },
  { name: "Sparrow Rewards", category: "finance", contact: "email" },
  { name: "Bluebird Telehealth", category: "health", contact: "form" },
];

function contactFields(domain: string, contact: ContactMethod) {
  return {
    privacyEmail: contact === "email" || contact === "both" ? `privacy@${domain}` : null,
    optOutUrl:
      contact === "form" || contact === "both" ? `https://www.${domain}/privacy/opt-out` : null,
    privacyRightsUrl: contact === "unknown" ? null : `https://www.${domain}/privacy`,
  };
}

function recipesFor(
  id: string,
  health: readonly TargetRecipe["health"][] | undefined,
): TargetRecipe[] {
  if (!health) return [];
  const purposes = ["scan", "remove"] as const;
  return health.map((value, index) => {
    const purpose = purposes[index] ?? "remove";
    return {
      id: `${id}.${purpose}.v1`,
      purpose,
      version: 1,
      source: "bundled" as const,
      status: "active" as const,
      health: value,
    };
  });
}

export function summaryOf(target: TargetDetail): TargetSummary {
  return {
    id: target.id,
    kind: target.kind,
    name: target.name,
    category: target.category,
    domain: target.domain,
    website: target.website,
    optOutUrl: target.optOutUrl,
    privacyRightsUrl: target.privacyRightsUrl,
    searchUrl: target.searchUrl,
    contactMethod: target.contactMethod,
    requiresId: target.requiresId,
    requirements: target.requirements,
    priority: target.priority,
    needsRecord: target.needsRecord,
    californiaRegistered: target.californiaRegistered,
    retired: target.retired,
  };
}

/** The health of the newest active recipe for a purpose, or null when the target has none. */
function automationOf(target: TargetDetail, purpose: "scan" | "remove") {
  const active = target.recipes
    .filter((recipe) => recipe.purpose === purpose && recipe.status === "active")
    .sort((a, b) => b.version - a.version);
  return active[0]?.health ?? null;
}

export function listItemOf(target: TargetDetail): TargetListItem {
  return {
    ...summaryOf(target),
    automation: { scan: automationOf(target, "scan"), remove: automationOf(target, "remove") },
  };
}

const PRIORITY_ORDER: Record<TargetPriority, number> = { crucial: 0, high: 1, normal: 2 };

function facet<T extends string>(values: readonly T[]) {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export default defineMockDomain({
  name: "targets",

  seed(store) {
    for (const seed of BROKERS) {
      const id = slugify(seed.name);
      const domain = `${id.replace(/-/g, "")}.example`;
      const requirements = seed.requirements ?? [];
      const category = seed.category;
      const detail: TargetDetail = {
        id,
        kind: "broker",
        name: seed.name,
        category,
        domain,
        website: `https://www.${domain}`,
        contactMethod: seed.contact,
        requiresId: requirements.includes("id_upload") || category === "requires-id",
        requirements,
        priority: seed.priority,
        needsRecord: needsRecord({ id, category }),
        californiaRegistered: category === "registered-broker",
        retired: false,
        ...contactFields(domain, seed.contact),
        searchUrl:
          category === "people-search" || category === "background-check"
            ? `https://www.${domain}/search`
            : null,
        region: "us",
        notes: seed.notes ?? null,
        sources:
          category === "registered-broker"
            ? [{ source: "ca-registry-2025", license: "public-record" }]
            : category === "people-search" || category === "background-check"
              ? [{ source: "badbool", license: "CC-BY-NC-SA-4.0" }]
              : [{ source: "eraser", license: "MIT" }],
        verifiedAt: null,
        recipes: recipesFor(id, seed.recipes),
      };
      store.targets.push(detail);
    }

    for (const seed of COMPANIES) {
      const id = slugify(seed.name);
      const domain = `${id.replace(/-/g, "")}.example`;
      store.targets.push({
        id,
        kind: "company",
        name: seed.name,
        category: seed.category,
        domain,
        website: `https://www.${domain}`,
        contactMethod: seed.contact,
        requiresId: false,
        requirements: [],
        priority: "normal",
        needsRecord: false,
        californiaRegistered: false,
        retired: false,
        ...contactFields(domain, seed.contact),
        searchUrl: null,
        region: "us",
        notes:
          seed.contact === "unknown" ? "The privacy page lists no contact for opt-outs." : null,
        sources: [{ source: "kickrocks-companies", license: "PolyForm-Noncommercial-1.0.0" }],
        verifiedAt: "2026-09-14",
        recipes: [],
      });
    }
  },

  routes: (store) => [
    handle(API_ROUTES.targetsList, ({ query }) => {
      const needle = query.q?.toLowerCase();
      const matches = store.targets
        .filter((target) => (query.kind ? target.kind === query.kind : true))
        .filter((target) => (query.category ? target.category === query.category : true))
        .filter((target) =>
          query.contactMethod ? target.contactMethod === query.contactMethod : true,
        )
        .filter((target) =>
          query.requirement ? target.requirements.includes(query.requirement) : true,
        )
        .filter((target) => (query.priority ? target.priority === query.priority : true))
        .filter((target) =>
          needle ? `${target.name} ${target.domain}`.toLowerCase().includes(needle) : true,
        )
        .sort(
          (a, b) =>
            PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || a.name.localeCompare(b.name),
        );
      const start = (query.page - 1) * query.pageSize;
      return {
        items: matches.slice(start, start + query.pageSize).map(listItemOf),
        total: matches.length,
        page: query.page,
        pageSize: query.pageSize,
      };
    }),

    handle(
      API_ROUTES.targetsFacets,
      (): TargetFacets => ({
        kind: facet(store.targets.map((target) => target.kind)),
        category: facet(store.targets.map((target) => target.category)),
        contactMethod: facet(store.targets.map((target) => target.contactMethod)),
        requirement: facet(store.targets.flatMap((target) => target.requirements)),
        priority: facet(store.targets.map((target) => target.priority)),
      }),
    ),

    handle(API_ROUTES.targetsGet, ({ params }) => {
      const target = store.targets.find((candidate) => candidate.id === params.id);
      if (!target) throw notFound("That target");
      return target;
    }),
  ],
});
