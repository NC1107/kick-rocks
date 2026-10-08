import { messages } from "@kickrocks/db";
import { API_ROUTES, type TaskSummary } from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { notFound } from "../../core/errors.js";
import { registerRoute } from "../../core/http.js";
import type { ModulePlugin } from "../../core/module.js";
import type { Task } from "../../core/task-types.js";
import { approveSubmit } from "./approve.js";
import { classifyByHand, decideMatch } from "./decisions.js";
import { toMessageDetail } from "./mappers.js";
import { buildReviewQueue } from "./queue.js";
import { retryFailedTask } from "./retry.js";

export const reviewModule: ModulePlugin = (app, services) => {
  const summary = (task: Task): TaskSummary =>
    services.taskQueue.summarize([task])[0] as TaskSummary;

  registerRoute(app, API_ROUTES.reviewQueue, ({ query }) =>
    buildReviewQueue(services, query.profileId),
  );

  registerRoute(app, API_ROUTES.taskResume, ({ params }) => ({
    task: summary(services.taskQueue.resume(params.id, "user")),
  }));

  registerRoute(app, API_ROUTES.taskApproveSubmit, ({ params }) => ({
    task: summary(approveSubmit(services, params.id)),
  }));

  registerRoute(app, API_ROUTES.taskCancel, ({ params }) => ({
    task: summary(services.taskQueue.cancel(params.id, "user")),
  }));

  registerRoute(app, API_ROUTES.taskMarkDone, ({ params, body }) => ({
    task: summary(
      services.taskQueue.markDone(params.id, {
        actor: "user",
        result: body.result,
        note: body.note,
      }),
    ),
  }));

  registerRoute(app, API_ROUTES.taskHandOff, ({ params }) => ({
    task: summary(services.dispatch.handToAgent(params.id, "user").task),
  }));

  registerRoute(app, API_ROUTES.taskRetry, ({ params }) => {
    const task = retryFailedTask(services, params.id);
    return { task: task ? summary(task) : null };
  });

  registerRoute(app, API_ROUTES.taskScreenshot, ({ params }) => {
    services.taskQueue.getOrThrow(params.id);
    const screenshot = services.taskQueue.screenshot(params.id);
    if (!screenshot) throw notFound("That task has no screenshot", "screenshot_not_found");
    return { contentType: screenshot.mime, data: screenshot.data };
  });

  registerRoute(app, API_ROUTES.matchDecide, ({ params, body }) =>
    decideMatch(services, params.id, body),
  );

  registerRoute(app, API_ROUTES.messageGet, ({ params }) => {
    const row = services.db.select().from(messages).where(eq(messages.id, params.id)).get();
    if (!row) throw notFound(`Message ${params.id} not found`, "message_not_found");
    return toMessageDetail(row);
  });

  registerRoute(app, API_ROUTES.messageClassify, ({ params, body }) =>
    classifyByHand(services, params.id, body),
  );
};
