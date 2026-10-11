import type { Broker } from "@kickrocks/shared";
import { parse } from "yaml";
import { z } from "zod";

const AliasesFile = z.object({
  aliases: z.array(
    z.object({
      broker: z.string().min(1),
      names: z.array(z.string().min(1).max(80)).min(1),
      source: z.string().min(1),
    }),
  ),
});

/**
 * Attaches the hand-curated alternative names to their brokers. An entry for a broker the dataset
 * does not list is an error, because it would silently tie nobody's mail to a request.
 */
export function applyAliases(brokers: readonly Broker[], yamlText: string): Broker[] {
  const { aliases: entries } = AliasesFile.parse(parse(yamlText));
  const known = new Set(brokers.map((broker) => broker.id));
  for (const entry of entries) {
    if (!known.has(entry.broker)) {
      throw new Error(`aliases name ${entry.broker}, which is not in the broker dataset`);
    }
  }
  return brokers.map((broker) => {
    const names = entries.filter((entry) => entry.broker === broker.id).flatMap((e) => e.names);
    return names.length === 0 ? broker : { ...broker, aliases: [...new Set(names)] };
  });
}
