import {
  type Broker,
  BrokerCategory,
  contactMethodFor,
  isOnDomain,
  normalizeDomain,
  Requirement,
  TargetPriority,
  WebUrl,
} from "@kickrocks/shared";
import { parse } from "yaml";
import { z } from "zod";

const CuratedEntry = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().min(1),
  domain: z.string().min(1),
  category: BrokerCategory,
  website: WebUrl.nullable().default(null),
  email: z.email().nullable().default(null),
  opt_out_url: WebUrl.nullable().default(null),
  search_url: WebUrl.nullable().default(null),
  requirements: z.array(Requirement).default([]),
  priority: TargetPriority.default("normal"),
  notes: z.string().nullable().default(null),
});

const CuratedFile = z.object({ brokers: z.array(CuratedEntry) });

/**
 * Hand-written broker records for sites that matter to a bundled recipe but that no imported list
 * carries. They merge last, so an imported record for the same domain always wins.
 */
export function parseCuratedBrokers(yamlText: string): Broker[] {
  const file = CuratedFile.parse(parse(yamlText));
  return file.brokers.map((entry) => {
    const domain = normalizeDomain(entry.domain);
    if (domain !== entry.domain) {
      throw new Error(`curated broker ${entry.id} has a domain that is not in its normal form`);
    }
    for (const url of [entry.website, entry.opt_out_url, entry.search_url]) {
      if (url && !isOnDomain(url, domain)) {
        throw new Error(`curated broker ${entry.id} links to ${url}, which is off ${domain}`);
      }
    }
    return {
      id: entry.id,
      name: entry.name,
      category: entry.category,
      website: entry.website,
      domain,
      privacyEmail: entry.email,
      optOutUrl: entry.opt_out_url,
      privacyRightsUrl: null,
      searchUrl: entry.search_url,
      contactMethod: contactMethodFor(entry.email, entry.opt_out_url),
      region: "us",
      requiresId: entry.requirements.includes("id_upload"),
      requirements: entry.requirements,
      priority: entry.priority,
      regulatedBy: [],
      collectsMinors: null,
      collectsGeolocation: null,
      collectsReproductiveHealth: null,
      metrics: null,
      notes: entry.notes,
      sources: [
        { source: "kickrocks", license: "PolyForm-Noncommercial-1.0.0", upstreamId: entry.id },
      ],
    } satisfies Broker;
  });
}
