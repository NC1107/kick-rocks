import {
  type Broker,
  contactMethodFor,
  rightsPageAsForm,
  type TargetPriority,
} from "@kickrocks/shared";

const PRIORITY_RANK: Record<TargetPriority, number> = { crucial: 2, high: 1, normal: 0 };

function higherPriority(a: TargetPriority, b: TargetPriority): TargetPriority {
  return PRIORITY_RANK[a] >= PRIORITY_RANK[b] ? a : b;
}

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
    searchUrl: primary.searchUrl ?? secondary.searchUrl,
    contactMethod: contactMethodFor(privacyEmail, optOutUrl ?? rightsPageAsForm(privacyRightsUrl)),
    requiresId: primary.requiresId || secondary.requiresId,
    requirements: Array.from(new Set([...primary.requirements, ...secondary.requirements])),
    priority: higherPriority(primary.priority, secondary.priority),
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

/**
 * A pinned Eraser record with no email, an opt-out URL and a note is a deliberate "do not email":
 * the note records a reply, a bounce or the form being the required path. Another list's address
 * for the same domain must not come back through the merge and send the request where the note
 * says it goes nowhere. A correction that re-adds an email to the Eraser record, with its source,
 * is the way to say otherwise.
 */
export function withholdEmailEraserRefused(lists: readonly (readonly Broker[])[]): Broker[][] {
  const refused = new Set(
    lists
      .flat()
      .filter(
        (broker) =>
          broker.sources.some((source) => source.source === "eraser") &&
          broker.privacyEmail === null &&
          broker.optOutUrl !== null &&
          broker.notes !== null,
      )
      .map((broker) => broker.domain),
  );
  return lists.map((list) =>
    list.map((broker) => {
      if (!refused.has(broker.domain) || broker.privacyEmail === null) return broker;
      return {
        ...broker,
        privacyEmail: null,
        contactMethod: contactMethodFor(
          null,
          broker.optOutUrl ?? rightsPageAsForm(broker.privacyRightsUrl),
        ),
      };
    }),
  );
}

export interface MergeOptions {
  /**
   * Domain to id, committed in `data/ids.json`. Recipes and requests refer to a broker by id, so an
   * id that has been published never changes, whichever list a record comes from or wins with.
   */
  pinnedIds?: Readonly<Record<string, string>>;
}

/**
 * Merges broker lists by domain. Earlier lists win ties, so pass the most curated list first.
 * A domain with a pinned id keeps it; every other record keeps its own id unless that id belongs to
 * someone else, in which case the domain is added to make it unique.
 */
export function mergeBrokers(
  lists: readonly (readonly Broker[])[],
  { pinnedIds = {} }: MergeOptions = {},
): Broker[] {
  const byDomain = new Map<string, Broker>();
  const usedIds = new Set<string>();
  const reservedIds = new Set(Object.values(pinnedIds));
  for (const list of lists) {
    for (const broker of list) {
      const existing = byDomain.get(broker.domain);
      if (existing) {
        byDomain.set(broker.domain, mergePair(existing, broker));
        continue;
      }
      const pinned = pinnedIds[broker.domain];
      let id = pinned ?? broker.id;
      if (pinned === undefined && (usedIds.has(id) || reservedIds.has(id))) {
        id = `${id}-${broker.domain.replace(/[^a-z0-9]+/g, "-")}`;
      }
      usedIds.add(id);
      byDomain.set(broker.domain, { ...broker, id });
    }
  }
  return Array.from(byDomain.values()).sort((a, b) => a.id.localeCompare(b.id));
}
