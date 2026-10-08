import {
  API_ROUTES,
  type OutgoingRequest,
  type OutgoingValue,
  type SendLog,
  type SendRow,
} from "@kickrocks/shared";
import { conflict, handle, type MockRoute, notFound } from "./core.js";
import { fakeScreenshotPng } from "./png.js";
import type { MockStore } from "./store.js";

/** What the mock keeps of one task's sends: the rows, and the values the placeholders stand for. */
export interface MockSends {
  rows: SendRow[];
  values: Record<string, string>;
}

type Kind = SendRow["kind"];

interface RowInit {
  seq: number;
  kind: Kind;
  status: SendRow["status"];
  request: SendRow["request"];
  createdAgo: { minutes?: number; hours?: number };
  reason?: string | null;
  expiresInMinutes?: number;
  hasScreenshot?: boolean;
  decidedBy?: string | null;
  released?: boolean;
  responseStatus?: number | null;
  resend?: boolean;
}

function rowOf(store: MockStore, init: RowInit): SendRow {
  const created = store.ago(init.createdAgo);
  return {
    id: store.nextId("snd"),
    attempt: 1,
    seq: init.seq,
    kind: init.kind,
    status: init.status,
    request: init.request,
    reason: init.reason ?? (init.resend ? "resend" : null),
    spendsSendId: null,
    hasScreenshot: init.hasScreenshot ?? false,
    expiresAt:
      init.expiresInMinutes === undefined ? null : store.ahead({ minutes: init.expiresInMinutes }),
    decidedBy: init.decidedBy ?? null,
    decidedAt: init.decidedBy ? created : null,
    releasedAt: init.released ? created : null,
    responseStatus: init.responseStatus ?? null,
    responseError: null,
    createdAt: created,
    resend: init.resend ?? false,
  };
}

function profile(
  path: string,
  value: string,
  field: "email" | "first_name" | "city" | "last_name",
) {
  return { path, value, class: "profile", fields: [field] } satisfies OutgoingValue;
}

/** A form post to a broker, shaped like the ones the worker holds. */
export function mockRequest(
  host: string,
  path: string,
  overrides: Partial<OutgoingRequest> = {},
): OutgoingRequest {
  return {
    method: "POST",
    scheme: "https",
    host,
    path,
    resourceType: "Document",
    isDocument: true,
    target: { type: "page", frameOrigin: `https://${host}`, topLevel: true },
    party: "target",
    bodyKind: "form",
    query: [],
    body: [
      profile("first_name", "{{first_name}}", "first_name"),
      profile("email", "{{email}}", "email"),
      { path: "csrf", value: "k3J9xQ2mLw8TzP4vRb7YcN1d", class: "served_token" },
      { path: "request_type", value: "delete", class: "literal" },
      { path: "share_with_partners", value: "no", class: "literal" },
    ],
    headers: [],
    bodyBytes: 142,
    bodyDigest: "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    carries: ["email", "first_name"],
    ...overrides,
  };
}

const RUN_STARTED = { note: "Run 1 started" };

/** A run that stopped at the second step of a form: step one went out, step two lapsed. */
export function twoStepLapse(store: MockStore, host: string): MockSends {
  const step1 = mockRequest(host, "/optout/step-1");
  const step2 = mockRequest(host, "/optout/step-2", {
    body: [
      { path: "ticket", value: "Zz8Qw1Er5Ty9Ui3Op7As2Df6", class: "served_token" },
      { path: "confirm", value: "yes", class: "literal" },
    ],
    carries: [],
    bodyBytes: 58,
  });
  return {
    values: { "{{email}}": "jordan.example@example.com", "{{first_name}}": "Jordan" },
    rows: [
      rowOf(store, {
        seq: 1,
        kind: "guard_event",
        status: "done",
        request: RUN_STARTED,
        reason: "run_started",
        createdAgo: { minutes: 52 },
      }),
      rowOf(store, {
        seq: 2,
        kind: "held",
        status: "sent",
        request: step1,
        decidedBy: "user",
        released: true,
        hasScreenshot: true,
        createdAgo: { minutes: 50 },
      }),
      rowOf(store, {
        seq: 3,
        kind: "released",
        status: "sent",
        request: step1,
        decidedBy: "user",
        released: true,
        responseStatus: 200,
        createdAgo: { minutes: 50 },
      }),
      rowOf(store, {
        seq: 4,
        kind: "held",
        status: "awaiting_next_run",
        request: step2,
        hasScreenshot: true,
        createdAgo: { minutes: 44 },
      }),
    ],
  };
}

/** A run that sent something nobody approved, with the lookups that led there. */
export function unapprovedRelease(store: MockStore, host: string): MockSends {
  const lookup = mockRequest(host, "/search", {
    method: "GET",
    resourceType: "Document",
    bodyKind: "none",
    query: [profile("first", "{{first_name}}", "first_name"), profile("city", "{{city}}", "city")],
    body: [],
    bodyBytes: 0,
    bodyDigest: "",
    carries: ["city", "first_name"],
  });
  return {
    values: {
      "{{first_name}}": "Jordan",
      "{{city}}": "Sampleton",
      "{{email}}": "jordan.example@example.com",
    },
    rows: [
      rowOf(store, {
        seq: 1,
        kind: "guard_event",
        status: "done",
        request: RUN_STARTED,
        reason: "run_started",
        createdAgo: { hours: 3, minutes: 10 },
      }),
      rowOf(store, {
        seq: 2,
        kind: "lookup",
        status: "done",
        request: lookup,
        createdAgo: { hours: 3 },
      }),
      rowOf(store, {
        seq: 3,
        kind: "released",
        status: "sent",
        request: mockRequest(host, "/remove"),
        decidedBy: "record",
        released: true,
        responseStatus: 200,
        createdAgo: { hours: 3 },
      }),
    ],
  };
}

/** A run that is paused right now, waiting for the person. */
export function liveHold(store: MockStore, host: string): MockSends {
  return {
    values: { "{{email}}": "jordan.example@example.com", "{{first_name}}": "Jordan" },
    rows: [
      rowOf(store, {
        seq: 1,
        kind: "guard_event",
        status: "done",
        request: { note: "Run 1 started" },
        reason: "run_started",
        createdAgo: { minutes: 3 },
      }),
      rowOf(store, {
        seq: 2,
        kind: "held",
        status: "pending_live",
        request: mockRequest(host, "/api/optout", {
          resourceType: "Fetch",
          isDocument: false,
          bodyKind: "json",
          body: [
            profile("subject.email", "{{email}}", "email"),
            { path: "subject.kind", value: "delete", class: "literal" },
            { path: "session", value: "7c1d0e3a9b4f4a2e8d6b5c3a", class: "served_token" },
          ],
        }),
        expiresInMinutes: 9,
        hasScreenshot: true,
        createdAgo: { minutes: 1 },
      }),
    ],
  };
}

const sendsOf = (store: MockStore, id: string): MockSends => {
  const sends = store.sends.get(id);
  if (!sends) throw notFound("That task has no sends, and it");
  return sends;
};

export function sendRoutes(store: MockStore): MockRoute[] {
  const log = (id: string): SendLog => {
    const sends = store.sends.get(id) ?? { rows: [], values: {} };
    const start = [...sends.rows].reverse().find((row) => row.reason === "run_started");
    return { sends: sends.rows, values: sends.values, runStartedSeq: start?.seq ?? 0 };
  };
  const taskOf = (id: string) => {
    const task = store.tasks.find((candidate) => candidate.id === id);
    if (!task) throw notFound("That task");
    return task;
  };

  return [
    handle(API_ROUTES.taskSends, ({ params }) => {
      taskOf(params.id);
      return log(params.id);
    }),

    handle(API_ROUTES.taskSendDecide, ({ params, body }) => {
      const task = taskOf(params.id);
      const { rows } = sendsOf(store, params.id);
      const row = rows.find((candidate) => candidate.id === params.sendId);
      if (!row) throw notFound("That request");
      const lapsed = row.expiresAt !== null && Date.parse(row.expiresAt) <= Date.now();
      if (row.kind !== "held" || row.status !== "pending_live" || lapsed) {
        throw conflict("That request is no longer waiting for a decision.");
      }
      const now = store.clock.now().toISOString();
      row.status = body.decision === "send" ? "sent" : "declined";
      row.decidedBy = "user";
      row.decidedAt = now;
      if (body.decision === "send" && "method" in row.request) {
        row.releasedAt = now;
        rows.push({
          ...row,
          id: store.nextId("snd"),
          seq: rows.length + 1,
          kind: "released",
          status: "sent",
          responseStatus: 200,
          expiresAt: null,
          hasScreenshot: false,
          createdAt: now,
        });
      }
      if (!rows.some((candidate) => candidate.status === "pending_live")) {
        task.updatedAt = now;
      }
      return { send: row };
    }),

    handle(API_ROUTES.taskSendScreenshot, ({ params }) => {
      const { rows } = sendsOf(store, params.id);
      const row = rows.find((candidate) => candidate.id === params.sendId);
      if (!row?.hasScreenshot) throw notFound("A screenshot for that request");
      return { binary: fakeScreenshotPng(), contentType: "image/png" };
    }),
  ];
}

/** Approves what a lapsed run held for the next run, the way the server does. */
export function approveHeld(store: MockStore, taskId: string, declineIds: readonly string[]): void {
  const sends = store.sends.get(taskId);
  const waiting = sends?.rows.filter(
    (row) => row.kind === "held" && row.status === "awaiting_next_run",
  );
  if (!sends || !waiting || waiting.length === 0) {
    throw conflict("That task has no held request to approve.");
  }
  for (const row of waiting)
    row.status = declineIds.includes(row.id) ? "declined" : "approved_next_run";
}
