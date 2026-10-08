import { type KickRocksDb, type TargetRow, targets } from "@kickrocks/db";
import type {
  Paged,
  TargetCategory,
  TargetDetail,
  TargetFacets,
  TargetListItem,
  TargetsQuery,
} from "@kickrocks/shared";
import { and, asc, desc, eq, notInArray, type SQL, sql } from "drizzle-orm";
import { approvedRecipesOf, NO_RECIPES } from "../../core/approved-recipes.js";
import { targetDetail } from "../../core/target-detail.js";
import { filterConditions, ID_REQUIREMENT, TARGET_ORDER } from "../../core/target-filter.js";
import type { TargetsService } from "../../core/targets.js";

const DIFFICULTY_ORDER = ["easy", "medium", "hard"] as const;

/** Categories that say what a site demands, which the Requirement filter already covers. */
const REQUIREMENT_CATEGORIES: TargetCategory[] = ["requires-id"];

export interface TargetCatalog {
  list(query: TargetsQuery): Paged<TargetListItem>;
  facets(): TargetFacets;
  detail(id: string): TargetDetail;
}

export function createTargetCatalog(
  db: KickRocksDb,
  targetsService: TargetsService,
): TargetCatalog {
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
    list({ page, pageSize, ...filter }) {
      // A retired target is no longer offered for browsing; its detail stays reachable by id so
      // the history of requests made to it keeps its meaning.
      let rows: TargetRow[];
      let total: number;
      if (filter.difficulty) {
        // Difficulty depends on recipes, which SQL cannot see, so it filters after the fact.
        const matching = targetsService.select(filter);
        total = matching.length;
        rows = matching.slice((page - 1) * pageSize, page * pageSize);
      } else {
        const where = and(eq(targets.retired, false), ...filterConditions(filter));
        total =
          db.select({ count: sql<number>`count(*)` }).from(targets).where(where).get()?.count ?? 0;
        rows = db
          .select()
          .from(targets)
          .where(where)
          .orderBy(...TARGET_ORDER)
          .limit(pageSize)
          .offset((page - 1) * pageSize)
          .all();
      }
      const automation = approvedRecipesOf(
        db,
        rows.map((row) => row.id),
      );
      const summaries = targetsService.toSummaries(rows);
      return {
        items: summaries.map((summary) => ({
          ...summary,
          automation: automation.get(summary.id) ?? NO_RECIPES,
        })),
        total,
        page,
        pageSize,
      };
    },

    facets() {
      const live = eq(targets.retired, false);
      const liveRows = db.select().from(targets).where(live).all();
      const listedRequirements = db
        .select({ value: sql<string>`json_each.value`, count: sql<number>`count(*)` })
        .from(targets)
        .innerJoin(sql`json_each(${targets.requirements})`, sql`1 = 1`)
        .where(and(live, sql`json_each.value <> ${ID_REQUIREMENT}`))
        .groupBy(sql`json_each.value`)
        .all();
      const asksForId =
        db
          .select({ count: sql<number>`count(*)` })
          .from(targets)
          .where(and(live, ...filterConditions({ requirement: ID_REQUIREMENT })))
          .get()?.count ?? 0;
      const difficulty = new Map<string, number>();
      for (const { difficulty: level } of targetsService.assess(liveRows).values()) {
        difficulty.set(level, (difficulty.get(level) ?? 0) + 1);
      }
      return {
        kind: countBy(sql`${targets.kind}`, live),
        category: countBy(
          sql`${targets.category}`,
          and(live, notInArray(targets.category, REQUIREMENT_CATEGORIES)),
        ),
        contactMethod: countBy(sql`${targets.contactMethod}`, live),
        difficulty: DIFFICULTY_ORDER.map((value) => ({ value, count: difficulty.get(value) ?? 0 })),
        priority: countBy(sql`${targets.priority}`, live),
        requirement: [
          ...listedRequirements,
          ...(asksForId > 0 ? [{ value: ID_REQUIREMENT, count: asksForId }] : []),
        ].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)),
      };
    },

    detail(id) {
      return targetDetail({ db, targets: targetsService }, id);
    },
  };
}
