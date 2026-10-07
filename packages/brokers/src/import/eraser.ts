import { type Broker, contactMethodFor, normalizeDomain, WebUrl } from "@kickrocks/shared";
import { parse } from "yaml";
import { z } from "zod";

const EraserEntry = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().default(""),
  website: z.string().default(""),
  opt_out_url: z.string().default(""),
  region: z.string().default("us"),
  category: z.string().default("marketing"),
  notes: z.string().optional(),
});

const EraserFile = z.object({ brokers: z.array(EraserEntry) });

const CATEGORY_MAP: Record<string, Broker["category"]> = {
  "people-search": "people-search",
  marketing: "marketing",
  "background-check": "background-check",
  "financial-b2b": "financial-b2b",
  "device-id-only": "device-id-only",
  "requires-id": "requires-id",
};

const REGION_MAP: Record<string, Broker["region"]> = {
  us: "us",
  eu: "eu",
  global: "global",
};

function emptyToNull(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function validUrlOrNull(value: string): string | null {
  const trimmed = emptyToNull(value);
  if (!trimmed) return null;
  return WebUrl.safeParse(trimmed).success ? trimmed : null;
}

function validEmailOrNull(value: string): string | null {
  const trimmed = emptyToNull(value);
  if (!trimmed) return null;
  return z.email().safeParse(trimmed).success ? trimmed : null;
}

export function parseEraserBrokers(yamlText: string): Broker[] {
  const file = EraserFile.parse(parse(yamlText));
  const brokers: Broker[] = [];
  for (const entry of file.brokers) {
    const website = validUrlOrNull(entry.website);
    const optOutUrl = validUrlOrNull(entry.opt_out_url);
    const domain =
      (website && normalizeDomain(website)) ??
      (optOutUrl && normalizeDomain(optOutUrl)) ??
      (entry.email.includes("@") ? normalizeDomain(entry.email.split("@")[1] ?? "") : null);
    if (!domain) continue;
    const privacyEmail = validEmailOrNull(entry.email);
    const category = CATEGORY_MAP[entry.category] ?? "marketing";
    brokers.push({
      id: entry.id,
      name: entry.name.trim(),
      category,
      website,
      domain,
      privacyEmail,
      optOutUrl,
      privacyRightsUrl: null,
      searchUrl: null,
      contactMethod: contactMethodFor(privacyEmail, optOutUrl),
      region: REGION_MAP[entry.region] ?? "us",
      requiresId: category === "requires-id",
      requirements: [],
      priority: "normal",
      regulatedBy: [],
      collectsMinors: null,
      collectsGeolocation: null,
      collectsReproductiveHealth: null,
      metrics: null,
      notes: entry.notes ? entry.notes.trim() : null,
      sources: [{ source: "eraser", license: "MIT", upstreamId: entry.id }],
    });
  }
  return brokers;
}
