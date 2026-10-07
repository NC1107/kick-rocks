import { type Broker, contactMethodFor } from "@kickrocks/shared";

/**
 * Eraser classifies brokers by what they do; the registry only knows they registered.
 * Keep the specific category and let the registry contribute what Eraser lacks.
 */
function mergePair(primary: Broker, secondary: Broker): Broker {
  const privacyEmail = primary.privacyEmail ?? secondary.privacyEmail;
  const optOutUrl = primary.optOutUrl ?? secondary.optOutUrl;
  const privacyRightsUrl = primary.privacyRightsUrl ?? secondary.privacyRightsUrl;
  const category = primary.category === "registered-broker" ? secondary.category : primary.category;
  const notes = [primary.notes, secondary.notes].filter(Boolean).join(" | ") || null;
  return {
    ...primary,
    category,
    website: primary.website ?? secondary.website,
    privacyEmail,
    optOutUrl,
    privacyRightsUrl,
    contactMethod: contactMethodFor(privacyEmail, optOutUrl ?? privacyRightsUrl),
    requiresId: primary.requiresId || secondary.requiresId,
    regulatedBy: Array.from(new Set([...primary.regulatedBy, ...secondary.regulatedBy])),
    collectsMinors: primary.collectsMinors ?? secondary.collectsMinors,
    collectsGeolocation: primary.collectsGeolocation ?? secondary.collectsGeolocation,
    collectsReproductiveHealth:
      primary.collectsReproductiveHealth ?? secondary.collectsReproductiveHealth,
    metrics: primary.metrics ?? secondary.metrics,
    notes,
    sources: [...primary.sources, ...secondary.sources],
  };
}

/** Merges broker lists by domain. Earlier lists win ties, so pass the most curated list first. */
export function mergeBrokers(...lists: readonly Broker[][]): Broker[] {
  const byDomain = new Map<string, Broker>();
  const usedIds = new Set<string>();
  for (const list of lists) {
    for (const broker of list) {
      const existing = byDomain.get(broker.domain);
      if (existing) {
        byDomain.set(broker.domain, mergePair(existing, broker));
        continue;
      }
      let id = broker.id;
      if (usedIds.has(id)) id = `${id}-${broker.domain.replace(/[^a-z0-9]+/g, "-")}`;
      usedIds.add(id);
      byDomain.set(broker.domain, { ...broker, id });
    }
  }
  return Array.from(byDomain.values()).sort((a, b) => a.id.localeCompare(b.id));
}
