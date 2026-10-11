import { type KickRocksDb, recipes } from "@kickrocks/db";
import { type ProfileField, Recipe, resolveProfileFields, type ScanHold } from "@kickrocks/shared";
import { and, desc, eq } from "drizzle-orm";
import type { AppServices } from "../services.js";
import { modelStance } from "./agent-policy.js";
import type { Clock } from "./clock.js";
import { loadIdentities } from "./identities.js";
import type { Task } from "./task-types.js";

/** What an agent needs to search a people-search site when no recipe will run the scan. */
const AGENT_SCAN_FIELDS: readonly ProfileField[] = ["full_name", "state"];

/** Fields a recipe types that come from somewhere other than the profile's identities. */
const NOT_FROM_IDENTITIES: readonly ProfileField[] = ["email", "record_url"];

const ADDRESS_FIELDS: readonly ProfileField[] = ["city", "state", "zip", "street"];
const NAME_FIELDS: readonly ProfileField[] = ["first_name", "last_name", "full_name"];

const FIELD_WORDS: Partial<Record<ProfileField, string>> = {
  first_name: "first name",
  last_name: "last name",
  full_name: "name",
  city: "city",
  state: "state",
  zip: "ZIP code",
  street: "street",
  phone: "phone number",
  birth_year: "date of birth",
  date_of_birth: "date of birth",
};

/**
 * The profile details a scan of this target would need and the profile does not have. A scan
 * searches by name and place, and a site that is searched without them fails after the browser has
 * already been opened, so the person is told before anything starts.
 */
export function missingScanFields(
  { db, clock }: { db: KickRocksDb; clock: Clock },
  profileId: string,
  targetId: string,
): ProfileField[] {
  const rows = db
    .select({ definition: recipes.definition, health: recipes.health })
    .from(recipes)
    .where(
      and(
        eq(recipes.targetId, targetId),
        eq(recipes.purpose, "scan"),
        eq(recipes.status, "active"),
      ),
    )
    .orderBy(desc(recipes.version))
    .all();
  const usable = rows.find((row) => row.health !== "broken");
  const wanted = usable
    ? Recipe.parse(usable.definition).fields.filter((field) => !NOT_FROM_IDENTITIES.includes(field))
    : AGENT_SCAN_FIELDS;
  const resolved = resolveProfileFields(loadIdentities(db, profileId), wanted, {
    asOf: clock.now().toISOString().slice(0, 10),
    nameId: null,
    addressId: null,
  });
  return wanted.filter((field) => resolved[field] === undefined);
}

/** The sentence that says what to add to the profile, in the profile's terms rather than field names. */
export function describeMissingScanFields(missing: readonly ProfileField[]): string {
  const address = missing.filter((field) => ADDRESS_FIELDS.includes(field));
  const name = missing.some((field) => NAME_FIELDS.includes(field));
  const parts = [
    ...(name ? ["a current name"] : []),
    ...(address.length > 0
      ? [`a current address with ${address.map((field) => FIELD_WORDS[field]).join(" and ")}`]
      : []),
    ...missing
      .filter((field) => !ADDRESS_FIELDS.includes(field) && !NAME_FIELDS.includes(field))
      .map((field) => `a ${FIELD_WORDS[field] ?? field}`),
  ];
  return parts.join(" and ");
}

type HoldServices = Pick<AppServices, "db" | "clock" | "taskQueue" | "settings">;

/** Why a queued scan that needs an agent is not being worked, from what the site's recipes say. */
function agentHold(services: HoldServices, task: Task<"agent">, siteName: string): ScanHold {
  const stance = modelStance(services, task);
  if (stance === "unreviewed" && !services.settings.get("agent.takeUnreviewed")) {
    return {
      reason: "recipe_unapproved",
      detail: `The recipe for ${siteName} is waiting for your review, so the agent worker leaves it alone.`,
    };
  }
  if (stance === "rejected") {
    return {
      reason: "recipe_unapproved",
      detail: `You rejected the recipe for ${siteName}, so it waits for a connected agent.`,
    };
  }
  if (task.payload.reason === "no_recipe") {
    return {
      reason: "no_recipe",
      detail: `${siteName} has no scripted search, so a connected agent has to run this scan.`,
    };
  }
  return {
    reason: "agent_required",
    detail: `The scripted search for ${siteName} stopped working, so a connected agent has to run this scan.`,
  };
}

/**
 * What keeps a queued scan from starting, or null when nothing does. The profile lacking details
 * comes first because no worker can get past it, then a scan only an agent can run, then the
 * politeness gate the built-in worker answers to.
 */
export function scanHold(
  services: HoldServices,
  scan: {
    profileId: string;
    targetId: string;
    targetName: string;
    taskId: string | null;
    taskStatus: string | null;
  },
): ScanHold | null {
  if (scan.taskId === null || scan.taskStatus !== "queued") return null;
  const task = services.taskQueue.get(scan.taskId);
  if (!task) return null;

  const missing = missingScanFields(services, scan.profileId, scan.targetId);
  if (missing.length > 0) {
    return {
      reason: "missing_fields",
      fields: missing,
      detail: `Add ${describeMissingScanFields(missing)} to this profile.`,
    };
  }
  if (task.kind === "agent") return agentHold(services, task as Task<"agent">, scan.targetName);

  const waiting = services.taskQueue.waitingFor(task);
  if (!waiting) return null;
  const serverClock =
    waiting.reason === "quiet_hours" && services.settings.get("scanning").timeZone === null;
  return {
    reason: waiting.reason,
    until: waiting.until,
    domain: waiting.domain,
    ...(serverClock
      ? {
          serverClock,
          detail: "Quiet hours are read on the server clock because no time zone is set.",
        }
      : {}),
  };
}
