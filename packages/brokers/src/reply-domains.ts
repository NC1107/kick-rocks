import { type Broker, ReplyDomains } from "@kickrocks/shared";
import { parse } from "yaml";
import { z } from "zod";

const ReplyDomainsFile = z.object({
  reply_domains: z.array(
    z.object({
      broker: z.string().min(1),
      domains: ReplyDomains.min(1),
      note: z.string().min(1),
    }),
  ),
});

/**
 * Attaches the hand-curated sister domains to their brokers. An entry for a broker the dataset
 * does not list is an error, because it would silently stop vouching for anyone.
 */
export function applyReplyDomains(brokers: readonly Broker[], yamlText: string): Broker[] {
  const { reply_domains: entries } = ReplyDomainsFile.parse(parse(yamlText));
  const byId = new Map(brokers.map((broker) => [broker.id, broker]));
  for (const entry of entries) {
    if (!byId.has(entry.broker)) {
      throw new Error(`reply domains name ${entry.broker}, which is not in the broker dataset`);
    }
  }
  return brokers.map((broker) => {
    const domains = entries.filter((entry) => entry.broker === broker.id).flatMap((e) => e.domains);
    return domains.length === 0 ? broker : { ...broker, replyDomains: [...new Set(domains)] };
  });
}
