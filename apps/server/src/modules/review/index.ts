import { messages } from "@kickrocks/db";
import {
  API_ROUTES,
  NEEDS_YOU_MAX_SNOOZE_DAYS,
  type NeedsYouRef,
  needsYouKey,
  type TaskSummary,
} from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { assignTask } from "../../core/assignment.js";
import { placeholderValues } from "../../core/claim.js";
import { conflict, invalidRequest, notFound } from "../../core/errors.js";
import { registerRoute } from "../../core/http.js";
import { scoreUnscoredMatches } from "../../core/match-assessment.js";
import type { ModulePlugin } from "../../core/module.js";
import type { Task } from "../../core/task-types.js";
import { approveSubmit } from "./approve.js";
import { classifyByHand, decideMatch } from "./decisions.js";
import { toMessageDetail } from "./mappers.js";
import { createMarks, requestIdOf, subjectOf } from "./marks.js";
import { buildNeedsYouQueue, needsYouCandidates } from "./needs-you.js";
import { buildReviewQueue } from "./queue.js";
import { retryFailedTask } from "./retry.js";

const DAY_MS = 24 * 60 * 60 * 1000;

export const reviewModule: ModulePlugin = (app, services) => {
  const marks = createMarks(services);
  const summary = (task: Task): TaskSummary =>
    services.taskQueue.summarize([task])[0] as TaskSummary;

  services.startup.onReady("match assessments", () => scoreUnscoredMatches(services.db));

  registerRoute(app, API_ROUTES.reviewQueue, ({ query }) =>
    buildReviewQueue(services, query.profileId),
  );

  registerRoute(app, API_ROUTES.needsYouGet, ({ query }) =>
    buildNeedsYouQueue(services, marks, query.profileId),
  );

  /** The item a mark is about, which must still be waiting on the person, snoozed or not. */
  function waitingItem(ref: NeedsYouRef, id: string) {
    const subject = subjectOf(services, ref, id);
    const key = needsYouKey(ref, id);
    const candidate = needsYouCandidates(services, subject.profileId).find(
      (entry) => entry.key === key,
    );
    if (!candidate) throw conflict("already_resolved", "That item no longer needs you");
    return { subject, kind: candidate.kind, since: candidate.since };
  }

  registerRoute(app, API_ROUTES.needsYouSnooze, ({ params, body }) => {
    const until = new Date(body.until).getTime();
    const now = services.clock.now().getTime();
    if (until <= now) throw invalidRequest("Snooze until a time in the future");
    if (until > now + NEEDS_YOU_MAX_SNOOZE_DAYS * DAY_MS) {
      throw invalidRequest(`Snooze for at most ${NEEDS_YOU_MAX_SNOOZE_DAYS} days`);
    }
    const { subject, kind, since } = waitingItem(params.kind, params.id);
    if (kind === "hold") {
      throw conflict("not_snoozable", "A held request runs out by itself, so it cannot wait");
    }
    return marks.snooze(subject, since, new Date(until).toISOString());
  });

  registerRoute(app, API_ROUTES.needsYouUnsnooze, ({ params }) => {
    const { subject, since } = waitingItem(params.kind, params.id);
    return marks.unsnooze(subject, since);
  });

  registerRoute(app, API_ROUTES.needsYouOpened, ({ params }) => {
    const { subject, since } = waitingItem(params.kind, params.id);
    return marks.opened(subject, since);
  });

  registerRoute(app, API_ROUTES.needsYouNotYet, ({ params, body }) => {
    const { subject, since } = waitingItem(params.kind, params.id);
    return services.db.transaction(() => {
      const requestId = requestIdOf(services, subject);
      if (requestId) {
        services.requests.addEvent(requestId, {
          type: "user_action",
          actor: "user",
          payload: { action: "not_yet", note: body.note ?? null },
        });
      }
      return marks.notYet(subject, since);
    });
  });

  registerRoute(app, API_ROUTES.taskResume, ({ params }) => {
    const task = summary(services.taskQueue.resume(params.id, "user"));
    marks.clearOpened("task", params.id);
    return { task };
  });

  registerRoute(app, API_ROUTES.taskApproveSubmit, ({ params, body }) => {
    const task = summary(approveSubmit(services, params.id, body));
    marks.clearOpened("task", params.id);
    return { task };
  });

  registerRoute(app, API_ROUTES.taskSends, ({ params }) => {
    const task = services.taskQueue.getOrThrow(params.id);
    const { sends, runStartedSeq } = services.taskSends.list(params.id);
    return {
      sends,
      runStartedSeq,
      values: task.kind === "agent" ? placeholderValues(services, task) : {},
    };
  });

  registerRoute(app, API_ROUTES.taskSendDecide, ({ params, body }) => {
    services.taskQueue.getOrThrow(params.id);
    return { send: services.taskSends.decide(params.id, params.sendId, body.decision) };
  });

  registerRoute(app, API_ROUTES.taskSendScreenshot, ({ params }) => {
    services.taskQueue.getOrThrow(params.id);
    const screenshot = services.taskSends.screenshot(params.id, params.sendId);
    if (!screenshot) throw notFound("That request has no screenshot", "screenshot_not_found");
    return { contentType: screenshot.mime, data: screenshot.data };
  });

  registerRoute(app, API_ROUTES.taskCancel, ({ params }) => {
    const task = summary(services.taskQueue.cancel(params.id, "user"));
    marks.clearOpened("task", params.id);
    return { task };
  });

  registerRoute(app, API_ROUTES.taskMarkDone, ({ params, body }) => {
    const task = summary(
      services.taskQueue.markDone(params.id, {
        actor: "user",
        result: body.result,
        note: body.note,
      }),
    );
    marks.clearOpened("task", params.id);
    return { task };
  });

  registerRoute(app, API_ROUTES.taskHandOff, ({ params, body }) => ({
    task: summary(
      services.db.transaction(() => {
        const { id } = services.dispatch.handToAgent(params.id, "user").task;
        if (body.to === undefined) return services.taskQueue.getOrThrow(id);
        return assignTask(services, id, body.to, body.fallback);
      }),
    ),
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

  registerRoute(app, API_ROUTES.matchDecide, ({ params, body }) => {
    const match = decideMatch(services, params.id, body);
    marks.clearOpened("match", params.id);
    return match;
  });

  registerRoute(app, API_ROUTES.messageGet, ({ params }) => {
    const row = services.db.select().from(messages).where(eq(messages.id, params.id)).get();
    if (!row) throw notFound(`Message ${params.id} not found`, "message_not_found");
    return toMessageDetail(row);
  });

  registerRoute(app, API_ROUTES.messageClassify, ({ params, body }) =>
    classifyByHand(services, params.id, body),
  );
};
