import { type Broker, contactMethodFor, normalizeDomain, slugify, WebUrl } from "@kickrocks/shared";
import { z } from "zod";
import { usablePrivacyEmail } from "./privacy-email.js";

const OpteryEntry = z.object({
  id: z.number().int(),
  title: z.string(),
  website: z.string().default(""),
  opt_out_url: z.string().default(""),
  email: z.string().default(""),
  type: z.string().default(""),
});

/** Only sites that publish a person's record need a scan first; the rest take a request by name. */
const CATEGORY_BY_TYPE: Record<string, Broker["category"]> = {
  "People Search Site": "people-search",
  "Phone Directory": "people-search",
};

function webUrlOrNull(value: string): string | null {
  const trimmed = value.trim();
  return WebUrl.safeParse(trimmed).success ? trimmed : null;
}

/** Parses the Optery directory's `data/data-brokers.json`. */
export function parseOpteryBrokers(jsonText: string): Broker[] {
  const entries = z.array(OpteryEntry).parse(JSON.parse(jsonText));
  const brokers: Broker[] = [];
  const seenIds = new Set<string>();
  for (const entry of entries) {
    const website = webUrlOrNull(entry.website);
    const domain = website && normalizeDomain(website);
    const name = entry.title.trim();
    if (!domain || !name) continue;
    const privacyEmail = usablePrivacyEmail(entry.email, [domain]);
    const optOutUrl = webUrlOrNull(entry.opt_out_url);
    let id = slugify(name) || slugify(domain);
    if (seenIds.has(id)) id = `${id}-${slugify(domain)}`;
    seenIds.add(id);
    brokers.push({
      id,
      name,
      category: CATEGORY_BY_TYPE[entry.type] ?? "marketing",
      website,
      domain,
      privacyEmail,
      optOutUrl,
      privacyRightsUrl: null,
      searchUrl: null,
      contactMethod: contactMethodFor(privacyEmail, optOutUrl),
      region: "us",
      requiresId: false,
      requirements: [],
      priority: "normal",
      regulatedBy: [],
      collectsMinors: null,
      collectsGeolocation: null,
      collectsReproductiveHealth: null,
      metrics: null,
      notes: null,
      sources: [{ source: "optery", license: "CC-BY-NC-SA-4.0", upstreamId: String(entry.id) }],
    });
  }
  return brokers;
}
