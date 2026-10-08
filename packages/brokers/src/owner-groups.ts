import { type Broker, OwnerGroup, registrableDomain } from "@kickrocks/shared";
import { parse } from "yaml";
import { z } from "zod";

const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

const OwnerGroupsFile = z.object({
  owner_groups: z.array(
    z.object({
      owner: OwnerGroup,
      domains: z.array(z.string().regex(HOST)).min(2),
      note: z.string().min(1),
    }),
  ),
});

/**
 * Marks the brokers that share an operator, so politeness treats them as one site. A domain in two
 * groups is an error, and so is a group that matches no broker in the dataset.
 */
export function applyOwnerGroups(brokers: readonly Broker[], yamlText: string): Broker[] {
  const { owner_groups: groups } = OwnerGroupsFile.parse(parse(yamlText));
  const ownerOf = new Map<string, string>();
  for (const group of groups) {
    for (const domain of group.domains) {
      const earlier = ownerOf.get(domain);
      if (earlier !== undefined) {
        throw new Error(`${domain} is in the owner groups ${earlier} and ${group.owner}`);
      }
      ownerOf.set(domain, group.owner);
    }
  }
  const matched = new Set<string>();
  const marked = brokers.map((broker) => {
    const owner = ownerOf.get(registrableDomain(broker.domain));
    if (owner === undefined) return broker;
    matched.add(owner);
    return { ...broker, ownerGroup: owner };
  });
  for (const group of groups) {
    if (!matched.has(group.owner)) {
      throw new Error(`the owner group ${group.owner} matches no broker in the dataset`);
    }
  }
  return marked;
}
