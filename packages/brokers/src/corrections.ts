import {
  type Broker,
  BrokerCategory,
  contactMethodOfRecord,
  normalizeDomain,
  Requirement,
  WebUrl,
} from "@kickrocks/shared";
import { parse } from "yaml";
import { z } from "zod";

const Correction = z.object({
  /** The domain the imported record carries, before the correction moves it. */
  domain: z.string().min(1),
  set: z
    .object({
      domain: z.string().min(1).optional(),
      website: WebUrl.nullable().optional(),
      email: z.email().nullable().optional(),
      privacy_rights_url: WebUrl.nullable().optional(),
      opt_out_url: WebUrl.nullable().optional(),
      category: BrokerCategory.optional(),
      /** Flags the broker's own pages disprove. Only removal is allowed, so a flag is never invented. */
      remove_requirements: z.array(Requirement).min(1).optional(),
      /** Flags the broker's own pages prove and no list carries. */
      add_requirements: z.array(Requirement).min(1).optional(),
    })
    .refine((fields) => Object.keys(fields).length > 0, "a correction must set a field"),
  source_urls: z.array(WebUrl).min(1),
  checked: z.iso.date(),
  note: z.string().min(1),
});
export type Correction = z.infer<typeof Correction>;

const CorrectionsFile = z.object({ corrections: z.array(Correction) });

const EmailRefusal = z.object({
  domain: z.string().min(1),
  /** Set when one mailbox bounced, so only that address is withheld and the rest stay untried. */
  address: z.email().optional(),
  source_urls: z.array(WebUrl).min(1),
  checked: z.iso.date(),
  note: z.string().min(1),
});
export type EmailRefusal = z.infer<typeof EmailRefusal>;

export function parseEmailRefusals(yamlText: string): EmailRefusal[] {
  const { email_refused } = z
    .object({ email_refused: z.array(EmailRefusal) })
    .parse(parse(yamlText));
  for (const { domain, address } of email_refused) {
    if (normalizeDomain(domain) !== domain) {
      throw new Error(`email refusal ${domain} is not in its normal form`);
    }
    if (address !== undefined && address !== address.toLowerCase()) {
      throw new Error(`email refusal ${domain} names an address that is not lower case`);
    }
  }
  return email_refused;
}

export function parseCorrections(yamlText: string): Correction[] {
  const { corrections } = CorrectionsFile.parse(parse(yamlText));
  for (const correction of corrections) {
    for (const domain of [correction.domain, correction.set.domain]) {
      if (domain !== undefined && normalizeDomain(domain) !== domain) {
        throw new Error(
          `correction for ${correction.domain} has a domain that is not in its normal form`,
        );
      }
    }
  }
  return corrections;
}

function correct(broker: Broker, { set }: Correction): Broker {
  const privacyEmail = set.email === undefined ? broker.privacyEmail : set.email;
  const optOutUrl = set.opt_out_url === undefined ? broker.optOutUrl : set.opt_out_url;
  const privacyRightsUrl =
    set.privacy_rights_url === undefined ? broker.privacyRightsUrl : set.privacy_rights_url;
  const requirements = [
    ...broker.requirements.filter((requirement) => !set.remove_requirements?.includes(requirement)),
    ...(set.add_requirements ?? []).filter(
      (requirement) => !broker.requirements.includes(requirement),
    ),
  ];
  return {
    ...broker,
    domain: set.domain ?? broker.domain,
    website: set.website === undefined ? broker.website : set.website,
    privacyEmail,
    optOutUrl,
    privacyRightsUrl,
    category: set.category ?? broker.category,
    requirements,
    contactMethod: contactMethodOfRecord({
      privacyEmail,
      optOutUrl,
      privacyRightsUrl,
      requirements,
    }),
  };
}

function changesRecord(broker: Broker, correction: Correction): boolean {
  const corrected = correct(broker, correction);
  return (
    corrected.domain !== broker.domain ||
    corrected.website !== broker.website ||
    corrected.privacyEmail !== broker.privacyEmail ||
    corrected.optOutUrl !== broker.optOutUrl ||
    corrected.privacyRightsUrl !== broker.privacyRightsUrl ||
    corrected.category !== broker.category ||
    corrected.requirements.length !== broker.requirements.length ||
    corrected.contactMethod !== broker.contactMethod
  );
}

/** A flag a correction removes must exist on a matched record, or the correction carries a dead part. */
function deadRemovals(correction: Correction, matches: readonly Broker[]): Requirement[] {
  return (correction.set.remove_requirements ?? []).filter(
    (requirement) => !matches.some((broker) => broker.requirements.includes(requirement)),
  );
}

function correctLists(lists: readonly (readonly Broker[])[], corrections: readonly Correction[]) {
  const matched = new Set<Correction>();
  const changed = new Set<Correction>();
  const corrected = lists.map((list) =>
    list.map((broker) => {
      const found = corrections.filter((correction) => correction.domain === broker.domain);
      for (const correction of found) {
        matched.add(correction);
        if (changesRecord(broker, correction)) changed.add(correction);
      }
      return found.reduce(correct, broker);
    }),
  );
  return { corrected, matched, changed };
}

/**
 * Applies hand-checked fixes to imported records before they merge, because an imported record
 * always wins over the curated list and an upstream list can be wrong for a long time. A correction
 * is stale, and an error, when it matches no record (the upstream list dropped the broker), when it
 * changes none of the records it matches, when it removes a flag no matched record carries, or, when
 * `merge` is given, when the merged result is the same without it (another list carries the fix and
 * wins the merge). The merge check is what sees a category that a later list already supplies.
 */
export function applyCorrections(
  lists: readonly (readonly Broker[])[],
  corrections: readonly Correction[],
  merge?: (lists: readonly (readonly Broker[])[]) => readonly Broker[],
): Broker[][] {
  const { corrected, matched, changed } = correctLists(lists, corrections);
  const stale = corrections.filter((correction) => !matched.has(correction));
  if (stale.length > 0) {
    throw new Error(
      `corrections match no imported record: ${stale.map((c) => c.domain).join(", ")}`,
    );
  }
  const redundant = corrections.filter(
    (correction) => matched.has(correction) && !changed.has(correction),
  );
  if (redundant.length > 0) {
    throw new Error(
      `corrections change nothing because upstream already carries them: ${redundant.map((c) => c.domain).join(", ")}`,
    );
  }
  const all = lists.flat();
  const dead = corrections.flatMap((correction) => {
    const flags = deadRemovals(
      correction,
      all.filter((broker) => broker.domain === correction.domain),
    );
    return flags.length > 0 ? [`${correction.domain} (${flags.join(", ")})`] : [];
  });
  if (dead.length > 0) {
    throw new Error(`corrections remove flags no imported record carries: ${dead.join(", ")}`);
  }
  if (merge) {
    const withAll = JSON.stringify(merge(corrected));
    const moot = corrections.filter(
      (correction) =>
        JSON.stringify(
          merge(
            correctLists(
              lists,
              corrections.filter((other) => other !== correction),
            ).corrected,
          ),
        ) === withAll,
    );
    if (moot.length > 0) {
      throw new Error(
        `corrections change nothing in the merged dataset because another list carries them: ${moot.map((c) => c.domain).join(", ")}`,
      );
    }
  }
  return corrected;
}

const Exclusion = z.object({
  domain: z.string().min(1),
  reason: z.string().min(1),
  source_urls: z.array(WebUrl).min(1),
  checked: z.iso.date(),
});
export type Exclusion = z.infer<typeof Exclusion>;

export function parseExclusions(yamlText: string): Exclusion[] {
  const { excluded } = z.object({ excluded: z.array(Exclusion) }).parse(parse(yamlText));
  for (const { domain } of excluded) {
    if (normalizeDomain(domain) !== domain) {
      throw new Error(`exclusion ${domain} is not in its normal form`);
    }
  }
  return excluded;
}

/**
 * Drops imported records for sites that one list has dropped but another still carries, and for
 * domains that already belong to another kind of target, so a site is never listed twice.
 */
export function dropExcluded(
  lists: readonly (readonly Broker[])[],
  domains: ReadonlySet<string>,
): Broker[][] {
  return lists.map((list) => list.filter((broker) => !domains.has(broker.domain)));
}
