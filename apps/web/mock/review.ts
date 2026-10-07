import {
  API_ROUTES,
  type BlockedReason,
  type BlockedTaskItem,
  type Match,
  type MessageSummary,
  type ReviewMessage,
  type ScanSummary,
  type TargetOutcome,
  type TaskSummary,
} from "@kickrocks/shared";
import { conflict, defineMockDomain, handle, notFound } from "./core.js";
import { fakeScreenshotPng } from "./png.js";
import { addEvent, buildRequest } from "./requests.js";
import type { MockStore } from "./store.js";

const MANUAL_INSTRUCTIONS: Record<BlockedReason, string> = {
  captcha:
    "Open the page, solve the CAPTCHA, and submit the form yourself. Then mark the task done.",
  phone_verification:
    "The site texts a code to a phone. Open the page, finish the check with your phone, then mark the task done.",
  id_upload:
    "The site wants a photo of ID. Kick Rocks never uploads ID for you. Decide whether to send it, then mark the task done or cancel it.",
  email_verification:
    "Check your inbox for the site's message, follow its link, then mark the task done.",
  login_required:
    "The site wants you to sign in first. Create or use an account, finish the removal, then mark the task done.",
  bot_detection:
    "The site blocked the automated browser. Open the page in your own browser and finish the removal.",
  recipe_failed:
    "The saved steps no longer match the page. Finish the removal by hand, then mark the task done.",
  unknown: "Open the page and finish the removal by hand, then mark the task done.",
};

function toSummary(message: ReviewMessage): MessageSummary {
  const { requestReference: _reference, targetName: _name, ...rest } = message;
  return rest;
}

function recountScan(store: MockStore, scanId: string): void {
  const scan = store.scans.find((candidate) => candidate.id === scanId);
  if (!scan) return;
  const own = store.matches.filter((match) => match.scanId === scanId);
  scan.matchCounts = {
    pending: own.filter((match) => match.decision === "pending").length,
    mine: own.filter((match) => match.decision === "mine").length,
    not_mine: own.filter((match) => match.decision === "not_mine").length,
  };
  scan.candidateCount = own.length;
}

export function createScan(
  store: MockStore,
  profileId: string,
  targetId: string,
  fields: Partial<Pick<ScanSummary, "taskStatus" | "error">> & {
    finished: boolean;
    startedAgo: { days?: number; hours?: number; minutes?: number };
  },
): ScanSummary | null {
  const target = store.targets.find((candidate) => candidate.id === targetId);
  if (!target) return null;
  const task = {
    id: store.nextId("tsk"),
    kind: "scan" as const,
    status: fields.taskStatus ?? "done",
    priority: 0,
    profileId,
    targetId,
    targetName: target.name,
    requestId: null,
    blockedReason: null,
    blockedDetail: null,
    attempts: 1,
    maxAttempts: 3,
    lastError: fields.error ?? null,
    hasScreenshot: false,
    createdAt: store.ago(fields.startedAgo),
    updatedAt: store.ago({ hours: 0, minutes: 5 }),
  } satisfies TaskSummary;
  store.tasks.push(task);
  const scan: ScanSummary = {
    id: store.nextId("scn"),
    profileId,
    targetId,
    targetName: target.name,
    taskId: task.id,
    taskStatus: task.status,
    startedAt: store.ago(fields.startedAgo),
    finishedAt: fields.finished ? store.ago({ hours: 0, minutes: 5 }) : null,
    candidateCount: 0,
    matchCounts: { pending: 0, mine: 0, not_mine: 0 },
    error: fields.error ?? null,
  };
  store.scans.push(scan);
  return scan;
}

function seedMatch(
  store: MockStore,
  scan: ScanSummary,
  recordUrl: string,
  fields: Match["fields"],
  decision: Match["decision"] = "pending",
): void {
  store.matches.push({
    id: store.nextId("mtc"),
    scanId: scan.id,
    profileId: scan.profileId,
    targetId: scan.targetId,
    targetName: scan.targetName,
    recordUrl,
    fields,
    decision,
    decidedAt: decision === "pending" ? null : store.ago({ hours: 2 }),
    requestId: null,
  });
  recountScan(store, scan.id);
}

export default defineMockDomain({
  name: "review",

  seed(store) {
    const jordan = store.profiles[0];
    if (!jordan) return;

    for (const task of store.tasks) {
      if (task.status === "blocked" && task.blockedReason) {
        const request = store.requests.find((candidate) => candidate.id === task.requestId);
        const target = store.targets.find((candidate) => candidate.id === task.targetId);
        store.blockedInfo.set(task.id, {
          url: request?.recordUrl ?? target?.optOutUrl ?? null,
          manualInstructions: MANUAL_INSTRUCTIONS[task.blockedReason],
        });
      }
    }

    const lookup = createScan(store, jordan.id, "namelookup", {
      finished: true,
      startedAgo: { hours: 30 },
    });
    if (lookup) {
      seedMatch(store, lookup, "https://www.namelookup.example/p/jordan-q-example-ca-30219", {
        name: "Jordan Q Example",
        age: 35,
        locations: ["Sampleton, CA", "Testville, CA"],
        relatives: ["Casey Example", "Morgan Example"],
        phones: ["(555) 555-0123"],
        emails: ["j***@example.com"],
      });
      seedMatch(store, lookup, "https://www.namelookup.example/p/jordan-example-tx-88120", {
        name: "Jordan Example",
        age: 62,
        locations: ["Exampleburg, TX"],
        relatives: ["Pat Example"],
      });
      seedMatch(
        store,
        lookup,
        "https://www.namelookup.example/p/j-example-ca-10442",
        { name: "J Example", age: 34, locations: ["Sampleton, CA"] },
        "not_mine",
      );
    }

    const cityfile = createScan(store, jordan.id, "cityfile-directory", {
      finished: true,
      startedAgo: { hours: 26 },
    });
    if (cityfile) {
      seedMatch(
        store,
        cityfile,
        "https://www.cityfiledirectory.example/people/jordan-example/9918",
        {
          name: "Jordan Q. Example",
          age: 35,
          locations: ["Sampleton, CA"],
          phones: ["(555) 555-0123"],
        },
      );
    }

    createScan(store, jordan.id, "locata", {
      taskStatus: "leased",
      finished: false,
      startedAgo: { minutes: 4 },
    });
    createScan(store, jordan.id, "kinsearch", {
      taskStatus: "failed",
      finished: true,
      error: "The search page did not load after three tries.",
      startedAgo: { days: 3 },
    });

    const targetNames = new Map(store.targets.map((target) => [target.id, target.name]));
    const unclassified: Omit<ReviewMessage, "id" | "mailboxId" | "receivedAt">[] = [
      {
        requestId: null,
        fromAddress: "support@brightlist.example",
        subject: "Your recent message",
        classification: "unknown",
        confidence: 0.31,
        rationale: "No reference number and no clear request wording.",
        links: [],
        snippet:
          "Thanks for reaching out. A member of our team will look into this and get back to you when we can.",
        reviewed: false,
        requestReference: null,
        targetName: null,
      },
      {
        requestId:
          store.requests.find((request) => request.targetId === "cardinal-insights")?.id ?? null,
        fromAddress: "privacy@cardinalinsights.example",
        subject: "Re: Opt-out request - please confirm",
        classification: "unknown",
        confidence: 0.44,
        rationale: "Mentions a confirmation step but no link was found.",
        links: ["https://www.cardinalinsights.example/privacy/confirm?token=mock"],
        snippet:
          "Before we can process your request we need you to confirm the address on file. Use the link below.",
        reviewed: false,
        requestReference:
          store.requests.find((request) => request.targetId === "cardinal-insights")?.reference ??
          null,
        targetName: targetNames.get("cardinal-insights") ?? null,
      },
    ];
    const mailboxId = jordan.mailbox?.id ?? "mbx_none";
    unclassified.forEach((message, index) => {
      store.messages.push({
        ...message,
        id: store.nextId("msg"),
        mailboxId,
        receivedAt: store.ago({ hours: 5 + index * 9 }),
      });
    });
  },

  routes: (store) => {
    const taskOf = (id: string): TaskSummary => {
      const task = store.tasks.find((candidate) => candidate.id === id);
      if (!task) throw notFound("That task");
      return task;
    };
    const touch = (task: TaskSummary, status: TaskSummary["status"]) => {
      task.status = status;
      task.updatedAt = store.clock.now().toISOString();
      if (status !== "blocked") {
        task.blockedReason = null;
        task.blockedDetail = null;
        store.blockedInfo.delete(task.id);
      }
      return task;
    };
    const noteOnRequest = (
      task: TaskSummary,
      type: "task_completed" | "user_action",
      payload: Record<string, unknown>,
    ) => {
      const request = store.requests.find((candidate) => candidate.id === task.requestId);
      if (request) {
        addEvent(store, request, type, "user", task.updatedAt, payload);
        request.updatedAt = task.updatedAt;
      }
    };

    return [
      handle(API_ROUTES.reviewQueue, ({ query }) => {
        const inScope = <T extends { profileId: string | null }>(item: T) =>
          query.profileId ? item.profileId === query.profileId : true;
        const blockedTasks: BlockedTaskItem[] = store.tasks
          .filter((task) => task.status === "blocked")
          .filter(inScope)
          .map((task) => {
            const request = store.requests.find((candidate) => candidate.id === task.requestId);
            const info = store.blockedInfo.get(task.id);
            return {
              task,
              requestReference: request?.reference ?? null,
              url: info?.url ?? null,
              manualInstructions: info?.manualInstructions ?? MANUAL_INSTRUCTIONS.unknown,
            };
          });
        const requestProfile = (message: ReviewMessage) =>
          store.requests.find((request) => request.id === message.requestId)?.profileId ??
          store.profiles.find((profile) => profile.mailbox?.id === message.mailboxId)?.id ??
          null;
        return {
          blockedTasks,
          matches: store.matches.filter(inScope).filter((match) => match.decision === "pending"),
          messages: store.messages
            .filter((message) => !message.reviewed)
            .filter((message) =>
              query.profileId ? requestProfile(message) === query.profileId : true,
            ),
        };
      }),

      handle(API_ROUTES.taskResume, ({ params }) => {
        const task = taskOf(params.id);
        if (task.status !== "blocked") throw conflict("Only a blocked task can be resumed.");
        touch(task, "queued");
        return { task };
      }),

      handle(API_ROUTES.taskCancel, ({ params }) => {
        const task = taskOf(params.id);
        if (task.status === "done" || task.status === "cancelled")
          throw conflict("That task is already closed.");
        touch(task, "cancelled");
        noteOnRequest(task, "user_action", { action: "cancel_task", taskId: task.id });
        return { task };
      }),

      handle(API_ROUTES.taskMarkDone, ({ params }) => {
        const task = taskOf(params.id);
        if (task.status !== "blocked") throw conflict("Only a blocked task can be marked done.");
        touch(task, "done");
        noteOnRequest(task, "task_completed", { markedBy: "user", taskId: task.id });
        return { task };
      }),

      handle(API_ROUTES.taskScreenshot, ({ params }) => {
        const task = taskOf(params.id);
        if (!task.hasScreenshot) throw notFound("A screenshot for that task");
        return { binary: fakeScreenshotPng(), contentType: "image/png" };
      }),

      handle(API_ROUTES.matchDecide, ({ params, body }) => {
        const match = store.matches.find((candidate) => candidate.id === params.id);
        if (!match) throw notFound("That match");
        if (match.decision !== "pending") throw conflict("That match was already decided.");
        match.decision = body.decision;
        match.decidedAt = store.clock.now().toISOString();
        if (body.decision === "mine") {
          const request = buildRequest(store, {
            profileId: match.profileId,
            targetId: match.targetId,
            channel: "form",
            rights: ["delete"],
            status: "queued",
            createdDaysAgo: 0,
            recordUrl: match.recordUrl,
          });
          match.requestId = request.id;
        }
        recountScan(store, match.scanId);
        return match;
      }),

      handle(API_ROUTES.messageClassify, ({ params, body }) => {
        const message = store.messages.find((candidate) => candidate.id === params.id);
        if (!message) throw notFound("That message");
        message.classification = body.classification;
        message.confidence = 1;
        message.reviewed = true;
        message.rationale = "Classified by you.";
        if (body.requestId) {
          const request = store.requests.find((candidate) => candidate.id === body.requestId);
          if (!request) throw notFound("That request");
          message.requestId = request.id;
          message.requestReference = request.reference;
          message.targetName = request.target.name;
        }
        return toSummary(message);
      }),

      handle(API_ROUTES.scansStart, ({ params, body }) => {
        const profile = store.profiles.find((candidate) => candidate.id === params.id);
        if (!profile) throw notFound("That profile");
        const targets =
          "preset" in body
            ? store.targets.filter((target) => target.needsRecord)
            : body.targetIds
                .map((id) => store.targets.find((target) => target.id === id))
                .filter((target) => target !== undefined);
        const items: TargetOutcome[] = targets.map((target) => {
          const running = store.scans.some(
            (scan) =>
              scan.profileId === profile.id &&
              scan.targetId === target.id &&
              scan.finishedAt === null,
          );
          if (running) {
            return {
              targetId: target.id,
              targetName: target.name,
              outcome: "skipped",
              requestId: null,
              scanId: null,
              reason: "scan_in_progress",
            };
          }
          const scan = createScan(store, profile.id, target.id, {
            taskStatus: "queued",
            finished: false,
            startedAgo: { hours: 0 },
          });
          return {
            targetId: target.id,
            targetName: target.name,
            outcome: "scan_started",
            requestId: null,
            scanId: scan?.id ?? null,
            reason: null,
          };
        });
        return { items };
      }),

      handle(API_ROUTES.scansList, ({ params, query }) => {
        const rows = store.scans
          .filter((scan) => scan.profileId === params.id)
          .sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        const start = (query.page - 1) * query.pageSize;
        return {
          items: rows.slice(start, start + query.pageSize),
          total: rows.length,
          page: query.page,
          pageSize: query.pageSize,
        };
      }),
    ];
  },
});
