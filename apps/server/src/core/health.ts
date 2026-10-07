import { profiles, targets } from "@kickrocks/db";
import { API_ROUTES } from "@kickrocks/shared";
import { and, count, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import type { AppServices } from "../services.js";
import { registerRoute } from "./http.js";

export function registerHealth(
  app: FastifyInstance,
  { db }: Pick<AppServices, "db">,
  version: string,
): void {
  registerRoute(app, API_ROUTES.health, () => ({ ok: true as const, version }));

  registerRoute(app, API_ROUTES.status, () => {
    const profileCount = db.select({ n: count() }).from(profiles).get()?.n ?? 0;
    const countKind = (kind: "broker" | "company") =>
      db
        .select({ n: count() })
        .from(targets)
        .where(and(eq(targets.kind, kind), eq(targets.retired, false)))
        .get()?.n ?? 0;
    const brokers = countKind("broker");
    return {
      profiles: profileCount,
      brokers: { available: brokers > 0, total: brokers },
      targets: { brokers, companies: countKind("company") },
    };
  });
}
