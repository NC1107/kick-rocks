import { profiles } from "@kickrocks/db";
import { API_ROUTES } from "@kickrocks/shared";
import { nowIso } from "../../core/clock.js";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import { createTaskOperations, WORKER_CALLER } from "./task-operations.js";

/**
 * The HTTP interface of the built-in worker. Everything it does is in `task-operations`, which the
 * MCP server shares, so a task behaves the same whoever works on it.
 */
export const workerApiModule: ModulePlugin = (app, services) => {
  const operations = createTaskOperations(services, WORKER_CALLER);

  registerRoute(app, API_ROUTES.workerHeartbeat, ({ body }) => {
    const now = nowIso(services.clock);
    services.settings.set("worker.status", {
      workerId: body.workerId,
      version: body.version ?? null,
      lastSeenAt: now,
      busy: body.busy,
      currentTaskId: body.currentTaskId ?? null,
    });
    const profileIds = services.db
      .select({ id: profiles.id })
      .from(profiles)
      .all()
      .map((row) => row.id);
    return { ok: true as const, serverTime: now, profileIds };
  });

  registerRoute(app, API_ROUTES.workerClaim, ({ body }) => ({
    task: operations.claim({
      workerId: body.workerId,
      kinds: body.kinds,
      leaseMs: body.leaseMs,
      claimerKind: body.claimer,
    }),
  }));

  registerRoute(app, API_ROUTES.workerTaskHeartbeat, ({ params, body }) =>
    operations.heartbeat(params.id, body),
  );

  registerRoute(app, API_ROUTES.workerTaskComplete, ({ params, body }) => ({
    task: operations.complete(params.id, body),
  }));

  registerRoute(app, API_ROUTES.workerTaskBlock, ({ params, body }) => ({
    task: operations.block(params.id, body),
  }));

  registerRoute(app, API_ROUTES.workerTaskFail, ({ params, body }) => ({
    task: operations.fail(params.id, body),
  }));

  registerRoute(app, API_ROUTES.workerTaskRelease, ({ params, body }) => ({
    task: operations.release(params.id, body),
  }));
};
