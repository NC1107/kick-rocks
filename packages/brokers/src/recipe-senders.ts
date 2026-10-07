import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Broker, Recipe } from "@kickrocks/shared";
import { isTrustedConfirmationDomain } from "./confirmation-sender.js";

/** The bundled recipes, read straight from their directory so this package needs no recipes dependency. */
export function readBundledRecipes(dir: string): Recipe[] {
  return readdirSync(dir)
    .filter((file) => file.endsWith(".json"))
    .map((file) => Recipe.parse(JSON.parse(readFileSync(join(dir, file), "utf8"))));
}

/**
 * The recipe steps whose confirmation sender the broker would not accept at run time: not the
 * broker's own organizational domain, and not one of its curated reply domains.
 */
export function unpairedRecipeSenders(
  brokers: readonly Broker[],
  recipes: readonly Recipe[],
): string[] {
  const byId = new Map(brokers.map((broker) => [broker.id, broker]));
  const problems: string[] = [];
  for (const recipe of recipes) {
    const sender = recipe.steps.find((step) => step.kind === "email_confirmation")?.fromDomain;
    if (sender === undefined) continue;
    const from = sender.trim().toLowerCase();
    for (const brokerId of [recipe.brokerId, ...recipe.alsoFor]) {
      const broker = byId.get(brokerId);
      if (!broker) {
        problems.push(`${recipe.id} serves ${brokerId}, which is not in the broker dataset`);
        continue;
      }
      const trusted = isTrustedConfirmationDomain(from, broker.domain, broker.replyDomains ?? []);
      if (!trusted) {
        problems.push(
          `${recipe.id} waits for mail from ${from}, which is neither in the organizational domain of ${broker.domain} nor a curated reply domain of ${brokerId}; add it to data/reply-domains.yaml`,
        );
      }
    }
  }
  return problems;
}
