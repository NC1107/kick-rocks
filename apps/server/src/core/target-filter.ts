import { type KickRocksDb, type TargetRow, targets } from "@kickrocks/db";
import type { TargetFilter } from "@kickrocks/shared";
import { and, asc, eq, type SQL, sql } from "drizzle-orm";
import { likePattern } from "./like.js";

export const ID_REQUIREMENT = "id_upload";

const PRIORITY_RANK = sql`case ${targets.priority} when 'crucial' then 0 when 'high' then 1 else 2 end`;

export type SqlTargetFilter = Omit<TargetFilter, "difficulty">;

/** The SQL half of a target filter; difficulty depends on recipes and is applied afterwards. */
export function filterConditions(filter: SqlTargetFilter): SQL[] {
  const conditions: SQL[] = [];
  if (filter.kind) conditions.push(eq(targets.kind, filter.kind));
  if (filter.category) conditions.push(eq(targets.category, filter.category));
  if (filter.contactMethod) conditions.push(eq(targets.contactMethod, filter.contactMethod));
  if (filter.priority) conditions.push(eq(targets.priority, filter.priority));
  if (filter.requirement) {
    const listed = sql`exists (select 1 from json_each(${targets.requirements}) where json_each.value = ${filter.requirement})`;
    // A site that wants ID is recorded in its category and flag, not always in its requirements.
    conditions.push(
      filter.requirement === ID_REQUIREMENT
        ? sql`(${listed} or ${targets.requiresId} = 1)`
        : listed,
    );
  }
  if (filter.q) {
    const pattern = likePattern(filter.q);
    conditions.push(
      sql`(${targets.name} like ${pattern} escape '\\' or ${targets.domain} like ${pattern} escape '\\')`,
    );
  }
  return conditions;
}

export const TARGET_ORDER = [PRIORITY_RANK, asc(sql`lower(${targets.name})`), asc(targets.id)];

/** Every live target the SQL half of the filter matches, in the order the targets list shows them. */
export function liveTargetsMatching(db: KickRocksDb, filter: SqlTargetFilter): TargetRow[] {
  return db
    .select()
    .from(targets)
    .where(and(eq(targets.retired, false), ...filterConditions(filter)))
    .orderBy(...TARGET_ORDER)
    .all();
}
