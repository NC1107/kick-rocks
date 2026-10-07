import { type KickRocksDb, recipes, targets } from "@kickrocks/db";
import type {
  Paged,
  RecipeHealth,
  RecipePurpose,
  TargetDetail,
  TargetFacets,
  TargetListItem,
  TargetsQuery,
} from "@kickrocks/shared";
import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import { targetDetail } from "../../core/target-detail.js";
import type { TargetsService } from "../../core/targets.js";

const PRIORITY_RANK = sql`case ${targets.priority} when 'crucial' then 0 when 'high' then 1 else 2 end`;

/** Escapes LIKE wildcards so a search for "100%" finds that text and not everything. */
function likePattern(text: string): string {
  return `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}

function filtersOf(query: Partial<TargetsQuery>): SQL[] {
  const conditions: SQL[] = [];
  if (query.kind) conditions.push(eq(targets.kind, query.kind));
  if (query.category) conditions.push(eq(targets.category, query.category));
  if (query.contactMethod) conditions.push(eq(targets.contactMethod, query.contactMethod));
  if (query.priority) conditions.push(eq(targets.priority, query.priority));
  if (query.requirement) {
    conditions.push(
      sql`exists (select 1 from json_each(${targets.requirements}) where json_each.value = ${query.requirement})`,
    );
  }
  if (query.q) {
    const pattern = likePattern(query.q);
    conditions.push(
      sql`(${targets.name} like ${pattern} escape '\\' or ${targets.domain} like ${pattern} escape '\\')`,
    );
  }
  return conditions;
}

export interface TargetCatalog {
  list(query: TargetsQuery): Paged<TargetListItem>;
  facets(): TargetFacets;
  detail(id: string): TargetDetail;
}

type Automation = Record<RecipePurpose, RecipeHealth | null>;

export function createTargetCatalog(
  db: KickRocksDb,
  targetsService: TargetsService,
): TargetCatalog {
  /**
   * What automation exists per target: the health of its newest active recipe for each purpose.
   * A proposal or a rejected recipe never runs, so it does not count as automation.
   */
  function automationOf(targetIds: readonly string[]): Map<string, Automation> {
    const result = new Map<string, Automation>();
    if (targetIds.length === 0) return result;
    const rows = db
      .select({ targetId: recipes.targetId, purpose: recipes.purpose, health: recipes.health })
      .from(recipes)
      .where(and(inArray(recipes.targetId, [...targetIds]), eq(recipes.status, "active")))
      .orderBy(asc(recipes.version))
      .all();
    // Ascending by version, so the last row written for a purpose is the newest.
    for (const row of rows) {
      const entry = result.get(row.targetId) ?? { scan: null, remove: null };
      entry[row.purpose] = row.health;
      result.set(row.targetId, entry);
    }
    return result;
  }

  function countBy(column: SQL, where: SQL | undefined) {
    return db
      .select({ value: sql<string>`${column}`, count: sql<number>`count(*)` })
      .from(targets)
      .where(where)
      .groupBy(column)
      .orderBy(desc(sql`count(*)`), asc(column))
      .all();
  }

  return {
    list(query) {
      // A retired target is no longer offered for browsing; its detail stays reachable by id so
      // the history of requests made to it keeps its meaning.
      const where = and(eq(targets.retired, false), ...filtersOf(query));
      const total =
        db.select({ count: sql<number>`count(*)` }).from(targets).where(where).get()?.count ?? 0;
      const rows = db
        .select()
        .from(targets)
        .where(where)
        .orderBy(PRIORITY_RANK, asc(sql`lower(${targets.name})`), asc(targets.id))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize)
        .all();
      const automation = automationOf(rows.map((row) => row.id));
      return {
        items: rows.map((row) => ({
          ...targetsService.toSummary(row),
          automation: automation.get(row.id) ?? { scan: null, remove: null },
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    },

    facets() {
      const live = eq(targets.retired, false);
      return {
        kind: countBy(sql`${targets.kind}`, live),
        category: countBy(sql`${targets.category}`, live),
        contactMethod: countBy(sql`${targets.contactMethod}`, live),
        priority: countBy(sql`${targets.priority}`, live),
        requirement: db
          .select({ value: sql<string>`json_each.value`, count: sql<number>`count(*)` })
          .from(targets)
          .innerJoin(sql`json_each(${targets.requirements})`, sql`1 = 1`)
          .where(live)
          .groupBy(sql`json_each.value`)
          .orderBy(desc(sql`count(*)`), asc(sql`json_each.value`))
          .all(),
      };
    },

    detail(id) {
      return targetDetail({ db, targets: targetsService }, id);
    },
  };
}
