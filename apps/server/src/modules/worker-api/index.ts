import { profiles } from "@kickrocks/db";
import { API_ROUTES, judgeGate, withoutPass, withPass } from "@kickrocks/shared";
import { nowIso } from "../../core/clock.js";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import { createTaskOperations, WORKER_CALLER } from "./task-operations.js";

const MAX_GATE_RECORDS = 100;

/**
 * The HTTP interface of the built-in worker. Everything it does is in `task-operations`, which the
 * MCP server shares, so a task behaves the same whoever works on it.
 */
export const workerApiModule: ModulePlugin = (app, services) => {
  const operations = createTaskOperations(services, WORKER_CALLER);

  registerRoute(app, API_ROUTES.workerHeartbeat, ({ body }) => {
    const now = nowIso(services.clock);
    services.settings.set(`worker.status.${body.claimer}`, {
      workerId: body.workerId,
      version: body.version ?? null,
      lastSeenAt: now,
      busy: body.busy,
      currentTaskId: body.currentTaskId ?? null,
      ...(body.resultPending ? { resultPending: true } : {}),
      ...(body.model ? { model: body.model } : {}),
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
      model: body.model,
    }),
  }));

  registerRoute(app, API_ROUTES.workerGateResult, ({ body }) => {
    const judgement = judgeGate(body);
    const { records } = services.settings.get("agent.gate");
    const updated = judgement.passed
      ? withPass(records, {
          model: body.model,
          source: "bench",
          recordedAt: nowIso(services.clock),
          runs: judgement.runs,
        })
      : withoutPass(records, body.model);
    services.settings.set("agent.gate", { records: updated.slice(-MAX_GATE_RECORDS) });
    return judgement;
  });

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

  registerRoute(app, API_ROUTES.workerSends, ({ params, body }) =>
    operations.registerSends(params.id, body),
  );

  registerRoute(app, API_ROUTES.workerSendDecision, ({ params, query }) =>
    operations.awaitDecision(params.id, params.sendId, query.workerId, query.waitMs),
  );

  registerRoute(app, API_ROUTES.workerSendRelease, ({ params, body }) => ({
    ok: true as const,
    ...operations.releaseSend(params.id, params.sendId, body),
  }));

  registerRoute(app, API_ROUTES.workerSendResult, ({ params, body }) => {
    operations.sendResult(params.id, params.sendId, body);
    return { ok: true as const };
  });

  registerRoute(app, API_ROUTES.workerTaskRelease, ({ params, body }) => ({
    task: operations.release(params.id, body),
  }));
};
