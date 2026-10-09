import {
  API_ROUTES,
  type BlockedReason,
  type BlockedTaskItem,
  canTransition,
  FORM_OUTCOMES,
  isActiveStatus,
  type Match,
  type MessageSummary,
  manualResultSchemaFor,
  type ReviewMessage,
  type ReviewQueue,
  type ScanSummary,
  type TargetOutcome,
  type TaskSummary,
  type VerificationItem,
  type WaitingTask,
} from "@kickrocks/shared";
import { conflict, defineMockDomain, handle, invalid, notFound } from "./core.js";
import { fakeScreenshotPng } from "./png.js";
import { addEvent, buildRequest, makeTask } from "./requests.js";
import { approveHeld, liveHold, sendRoutes, twoStepLapse, unapprovedRelease } from "./sends.js";
import type { MockStore } from "./store.js";
import { selectedByFilter } from "./targets.js";

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
  approval_needed:
    "Look at the requests the run held back. Approve them for the next run, or finish it yourself and mark it done.",
  unapproved_submit:
    "Open the site and check whether the form went out. If it did, mark the task done. If not, finish the removal yourself.",
  unknown: "Open the page and finish the removal by hand, then mark the task done.",
};

const LIVE_HOLD_INSTRUCTIONS =
  "The run is waiting for you. Look at what the page is about to send, then send it, hold it back, or finish by hand.";

const AGENT_INSTRUCTIONS =
  "No agent has taken this yet, and the recipe worker will not run it. Connect an agent in Settings, or open the page and finish the job yourself, then mark it done.";

const FAILED_INSTRUCTIONS =
  "This task failed and nothing will try it again by itself. Retry it, or finish the job by hand and mark it done.";

/** The days a failed task stays in the review queue. */
const FAILED_WINDOW_DAYS = 30;

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
    blockedUrl: null,
    attempts: 1,
    maxAttempts: 3,
    lastError: fields.error ?? null,
    failureKind: fields.taskStatus === "failed" ? ("site" as const) : null,
    failureStep: null,
    hasScreenshot: false,
    finishedBy:
      fields.taskStatus === "queued" || fields.taskStatus === "leased" ? null : "home-worker",
    claimerKind: fields.taskStatus === "queued" ? null : ("builtin" as const),
    usage: null,
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

/** What waits on the person, built the way the server builds it, so the dashboard counts the same list. */
export function buildMockQueue(store: MockStore, profileId: string | undefined): ReviewQueue {
  const requestOf = (task: TaskSummary) =>
    store.requests.find((candidate) => candidate.id === task.requestId);
  const inScope = <T extends { profileId: string | null }>(item: T) =>
    profileId ? item.profileId === profileId : true;
  const toItem = (task: TaskSummary): BlockedTaskItem => {
    const request = requestOf(task);
    const info = store.blockedInfo.get(task.id);
    const target = store.targets.find((candidate) => candidate.id === task.targetId);
    return {
      task,
      requestReference: request?.reference ?? null,
      url: info?.url ?? task.blockedUrl ?? request?.recordUrl ?? target?.optOutUrl ?? null,
      manualInstructions:
        info?.manualInstructions ??
        (task.status === "failed"
          ? FAILED_INSTRUCTIONS
          : task.status === "queued"
            ? AGENT_INSTRUCTIONS
            : task.status === "leased"
              ? LIVE_HOLD_INSTRUCTIONS
              : MANUAL_INSTRUCTIONS.unknown),
    };
  };
  const cutoff = store.ago({ days: FAILED_WINDOW_DAYS });
  const requestProfile = (message: ReviewMessage) =>
    store.requests.find((request) => request.id === message.requestId)?.profileId ??
    store.profiles.find((profile) => profile.mailbox?.id === message.mailboxId)?.id ??
    null;
  const verifications: VerificationItem[] = store.requests
    .filter((request) => request.status === "needs_verification")
    .filter(inScope)
    .flatMap((request) => {
      const message = store.messages
        .filter(
          (candidate) =>
            candidate.requestId === request.id &&
            candidate.classification === "verification_required",
        )
        .at(-1);
      if (!message) return [];
      const { events: _events, ...item } = request;
      return [
        {
          request: item,
          message: toSummary(message),
          requestedFields: message.requestedFields,
        },
      ];
    });
  const waitingTasks: WaitingTask[] = store.tasks
    .filter((task) => task.status === "queued" && task.kind !== "agent")
    .filter(inScope)
    .flatMap((task) => {
      const target = store.targets.find((candidate) => candidate.id === task.targetId);
      const site = store.sites.find((candidate) => candidate.domain === target?.domain);
      if (!target || !site?.coolingDownUntil) return [];
      return [
        {
          taskId: task.id,
          kind: task.kind,
          targetId: target.id,
          targetName: target.name,
          waiting: {
            reason:
              site.breaker === "open" ? ("site_breaker" as const) : ("site_cooldown" as const),
            domain: site.domain,
            until: site.coolingDownUntil,
          },
        },
      ];
    });
  return {
    blockedTasks: store.tasks
      .filter(
        (task) =>
          task.status === "blocked" ||
          (task.status === "leased" &&
            store.sends
              .get(task.id)
              ?.rows.some((row) => row.kind === "held" && row.status === "pending_live")),
      )
      .filter(inScope)
      .map(toItem),
    matches: store.matches.filter(inScope).filter((match) => match.decision === "pending"),
    verifications,
    failedTasks: store.tasks
      .filter((task) => task.status === "failed" && task.updatedAt >= cutoff)
      .filter(inScope)
      .filter((task) => {
        const request = requestOf(task);
        return request ? isActiveStatus(request.status) : true;
      })
      .map(toItem),
    agentTasks: store.tasks
      .filter((task) => task.kind === "agent" && task.status === "queued")
      .filter(inScope)
      .map(toItem),
    messages: store.messages
      .filter((message) => !message.reviewed)
      .filter((message) => (profileId ? requestProfile(message) === profileId : true)),
    waitingTasks,
    waitingTotal: waitingTasks.length,
  };
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
          url: task.blockedUrl ?? request?.recordUrl ?? target?.optOutUrl ?? null,
          manualInstructions: MANUAL_INSTRUCTIONS[task.blockedReason],
        });
      }
    }

    // Held back by the cooling sites seeded in the settings domain, so Review shows a Waiting group.
    for (const targetId of ["peopletrace", "findrecord"]) {
      createScan(store, jordan.id, targetId, {
        taskStatus: "queued",
        finished: false,
        startedAgo: { minutes: 12 },
      });
    }

    const waiting = store.requests.find(
      (request) => request.targetId === "quillnote" && request.profileId === jordan.id,
    );
    const quillnote = store.targets.find((target) => target.id === "quillnote");
    if (waiting && quillnote) {
      const task = makeTask(
        store,
        {
          kind: "agent",
          status: "blocked",
          profileId: jordan.id,
          targetId: quillnote.id,
          targetName: quillnote.name,
          requestId: waiting.id,
          blockedReason: "approval_needed",
          blockedDetail:
            "qwen3:14b has not passed the safety gate on this install, so a person approves each send, and nobody decided in time. 1 request was cancelled and left for you to approve.",
          blockedUrl: quillnote.optOutUrl,
          hasScreenshot: true,
        },
        { minutes: 40 },
      );
      task.claimerKind = "model";
      store.blockedInfo.set(task.id, {
        url: quillnote.optOutUrl,
        manualInstructions: MANUAL_INSTRUCTIONS.approval_needed,
      });
      store.sends.set(
        task.id,
        twoStepLapse(store, new URL(quillnote.optOutUrl ?? "https://quillnote.example").host),
      );
    }

    const sentRequest = store.requests.find(
      (request) => request.targetId === "harbor-consumer-data" && request.profileId === jordan.id,
    );
    const harbor = store.targets.find((target) => target.id === "harbor-consumer-data");
    if (sentRequest && harbor) {
      const task = makeTask(
        store,
        {
          kind: "agent",
          status: "blocked",
          profileId: jordan.id,
          targetId: harbor.id,
          targetName: harbor.name,
          requestId: sentRequest.id,
          blockedReason: "unapproved_submit",
          blockedDetail:
            "The agent worker reported a sent form that no one approved, so the form may already have been submitted. Check the site before you do anything else.",
          blockedUrl: harbor.optOutUrl,
        },
        { hours: 3 },
      );
      task.claimerKind = "model";
      store.blockedInfo.set(task.id, {
        url: harbor.optOutUrl,
        manualInstructions: MANUAL_INSTRUCTIONS.unapproved_submit,
      });
      store.sends.set(
        task.id,
        unapprovedRelease(store, new URL(harbor.optOutUrl ?? "https://harbor.example").host),
      );
    }

    const waitingOnYou = store.requests.find(
      (request) => request.targetId === "cardinal-insights" && request.profileId === jordan.id,
    );
    const cardinal = store.targets.find((target) => target.id === "cardinal-insights");
    if (waitingOnYou && cardinal) {
      const task = makeTask(
        store,
        {
          kind: "agent",
          status: "leased",
          profileId: jordan.id,
          targetId: cardinal.id,
          targetName: cardinal.name,
          requestId: waitingOnYou.id,
        },
        { minutes: 1 },
      );
      task.claimerKind = "model";
      store.blockedInfo.set(task.id, {
        url: cardinal.optOutUrl,
        manualInstructions: LIVE_HOLD_INSTRUCTIONS,
      });
      store.sends.set(
        task.id,
        liveHold(store, new URL(cardinal.optOutUrl ?? "https://cardinal.example").host),
      );
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
        requestedFields: [],
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
        requestedFields: [],
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
    const requestOf = (task: TaskSummary) =>
      store.requests.find((candidate) => candidate.id === task.requestId);
    const ref = (task: TaskSummary) => ({ taskId: task.id, kind: task.kind });

    return [
      ...sendRoutes(store),
      handle(API_ROUTES.reviewQueue, ({ query }) => buildMockQueue(store, query.profileId)),

      handle(API_ROUTES.taskResume, ({ params }) => {
        const task = taskOf(params.id);
        if (task.status !== "blocked") throw conflict("Only a blocked task can be resumed.");
        touch(task, "queued");
        const request = requestOf(task);
        if (request) addEvent(store, request, "task_resumed", "user", task.updatedAt, ref(task));
        return { task };
      }),

      handle(API_ROUTES.taskApproveSubmit, ({ params, body }) => {
        const task = taskOf(params.id);
        if (
          task.kind !== "agent" ||
          task.status !== "blocked" ||
          task.blockedReason !== "approval_needed"
        ) {
          throw conflict("That task is not waiting for a submit approval.");
        }
        approveHeld(store, task.id, body.declineSendIds);
        touch(task, "queued");
        const request = requestOf(task);
        if (request) addEvent(store, request, "task_resumed", "user", task.updatedAt, ref(task));
        return { task };
      }),

      handle(API_ROUTES.taskCancel, ({ params }) => {
        const task = taskOf(params.id);
        if (task.status === "done" || task.status === "cancelled" || task.status === "failed")
          throw conflict("That task is already closed.");
        touch(task, "cancelled");
        const request = requestOf(task);
        if (request) addEvent(store, request, "task_cancelled", "user", task.updatedAt, ref(task));
        return { task };
      }),

      handle(API_ROUTES.taskMarkDone, ({ params, body }) => {
        const task = taskOf(params.id);
        if (task.status !== "blocked" && !(task.status === "queued" && task.kind === "agent"))
          throw conflict("Only a blocked task can be marked done.");
        let outcome: string | null = null;
        if (body.result !== undefined) {
          const parsed = manualResultSchemaFor({
            kind: task.kind,
            payload: { purpose: task.kind === "agent" && !task.requestId ? "scan" : "remove" },
          }).safeParse(body.result);
          if (!parsed.success)
            throw invalid("That result is not valid for this task.", ["body", "result"]);
          outcome =
            typeof parsed.data === "object" && parsed.data !== null && "outcome" in parsed.data
              ? String(parsed.data.outcome)
              : null;
        }
        touch(task, "done");
        const request = requestOf(task);
        if (request) {
          addEvent(store, request, "task_completed", "system", task.updatedAt, {
            ...ref(task),
            outcome,
            note: body.note ?? null,
          });
          const to = outcome ? FORM_OUTCOMES[outcome as keyof typeof FORM_OUTCOMES] : undefined;
          if (to && canTransition(request.status, to, { actor: "user" })) {
            addEvent(store, request, "status_changed", "user", task.updatedAt, {
              from: request.status,
              to,
            });
            request.status = to;
          }
          request.updatedAt = task.updatedAt;
        }
        return { task };
      }),

      handle(API_ROUTES.taskHandOff, ({ params }) => {
        const task = taskOf(params.id);
        if (task.status !== "blocked")
          throw conflict("Only a blocked task can be handed to an agent.");
        if (task.kind !== "scan" && task.kind !== "form" && task.kind !== "agent") {
          throw conflict("An agent cannot take that kind of task.");
        }
        touch(task, "cancelled");
        const request = requestOf(task);
        if (request) addEvent(store, request, "task_cancelled", "user", task.updatedAt, ref(task));
        const handed = makeTask(
          store,
          {
            kind: "agent",
            status: "queued",
            profileId: task.profileId,
            targetId: task.targetId,
            targetName: task.targetName,
            requestId: task.requestId,
          },
          { minutes: 0 },
        );
        if (request)
          addEvent(store, request, "task_enqueued", "system", handed.updatedAt, ref(handed));
        const scan = store.scans.find((candidate) => candidate.taskId === task.id);
        if (scan) {
          scan.taskId = handed.id;
          scan.taskStatus = handed.status;
        }
        return { task: handed };
      }),

      handle(API_ROUTES.taskRetry, ({ params }) => {
        const task = taskOf(params.id);
        if (task.status !== "failed") throw conflict("Only a task that failed can be retried.");
        const request = requestOf(task);
        if (request && !isActiveStatus(request.status)) {
          throw conflict("That request is closed, so there is nothing to retry.");
        }
        const retried = makeTask(
          store,
          {
            kind: task.kind,
            status: "queued",
            profileId: task.profileId,
            targetId: task.targetId,
            targetName: task.targetName,
            requestId: task.requestId,
          },
          { minutes: 0 },
        );
        if (request) {
          request.lastError = null;
          addEvent(store, request, "user_action", "user", retried.updatedAt, {
            action: "retry_task",
            note: null,
          });
          addEvent(store, request, "task_enqueued", "system", retried.updatedAt, ref(retried));
        }
        return { task: retried };
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
            rights: body.rights,
            status: "queued",
            createdDaysAgo: 0,
            recordUrl: match.recordUrl,
          });
          match.requestId = request.id;
        }
        recountScan(store, match.scanId);
        return match;
      }),

      handle(API_ROUTES.messageGet, ({ params }) => {
        const message = store.messages.find((candidate) => candidate.id === params.id);
        if (!message) throw notFound("That message");
        const summary = toSummary(message);
        return {
          ...summary,
          text: `${message.snippet ?? ""}\n\nThis is the whole message. It is longer than the snippet shown in lists, so a person can read what the broker actually wrote before they classify it.`,
        };
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
            : "filter" in body
              ? selectedByFilter(store, body.filter)
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
              detail: null,
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
            detail: null,
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
