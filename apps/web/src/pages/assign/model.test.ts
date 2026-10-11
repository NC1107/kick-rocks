import type {
  AgentRow,
  AgentsResponse,
  RequestEvent,
  TaskAssignment,
  TaskSummary,
} from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import {
  agentChoice,
  assigneeTag,
  assignmentLine,
  calloutState,
  choiceOf,
  elapsedText,
  fallbackLabel,
  fallbackSentence,
  lapsedText,
  presenceLine,
  presenceWord,
  runNowRefusal,
  sendingLine,
  targetOf,
} from "./model.js";

const NOW = Date.parse("2026-10-11T15:00:00.000Z");
const minutesAgo = (minutes: number) => new Date(NOW - minutes * 60_000).toISOString();

function agent(overrides: Partial<AgentRow> = {}): AgentRow {
  return {
    kind: "model",
    workerId: "nick-pc-agent",
    model: {
      provider: "ollama",
      name: "gpt-oss:20b",
      version: null,
      thinking: "default",
      numCtx: null,
    },
    gate: { state: "unproven", unattended: false, record: null },
    lastSeenAt: minutesAgo(0),
    lastClaimAt: minutesAgo(0),
    online: true,
    busy: false,
    currentTargetName: null,
    refusal: null,
    ...overrides,
  };
}

const response = (...agents: AgentRow[]): AgentsResponse => ({
  agents,
  mcpEnabled: true,
  workerTokenSet: true,
});

function assignment(
  to: TaskAssignment["to"],
  overrides: Partial<TaskAssignment> = {},
): TaskAssignment {
  return { to, at: minutesAgo(1), by: "user", fallback: "any", ...overrides };
}

const model = { kind: "model", workerId: "nick-pc-agent" } as const;

function task(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: "tsk_1",
    kind: "agent",
    status: "queued",
    priority: 0,
    profileId: "p",
    targetId: "t",
    targetName: "Spokeo",
    requestId: "r",
    blockedReason: null,
    blockedDetail: null,
    blockedUrl: null,
    attempts: 0,
    maxAttempts: 3,
    lastError: null,
    failureKind: null,
    failureStep: null,
    hasScreenshot: false,
    finishedBy: null,
    claimerKind: null,
    usage: null,
    assignment: null,
    createdAt: minutesAgo(10),
    updatedAt: minutesAgo(10),
    ...overrides,
  };
}

describe("the picker's choices", () => {
  it("round-trips an assignment through the radio value and the route's body", () => {
    expect(choiceOf(null)).toBe("any");
    expect(choiceOf(assignment({ kind: "person" }))).toBe("person");
    const choice = choiceOf(assignment({ kind: "mcp", workerId: "desk:client" }));
    expect(choice).toBe("mcp:desk:client");
    expect(targetOf(choice)).toEqual({ kind: "mcp", workerId: "desk:client" });
    expect(targetOf("any")).toBe("any");
    expect(agentChoice(agent())).toBe("model:nick-pc-agent");
  });

  it("says what happens when the assignee goes quiet, in words", () => {
    expect(fallbackSentence("nick-pc-agent", "any")).toBe(
      "If nick-pc-agent is not seen for 30 minutes, any agent may take it.",
    );
    expect(fallbackSentence("nick-pc-agent", "person")).toBe(
      "If nick-pc-agent is not seen for 30 minutes, it comes back to you.",
    );
    expect(fallbackSentence("desk-client", "any", "mcp")).toBe(
      "If desk-client does not ask for work (claim_task) for 30 minutes, any agent may take it.",
    );
    expect(fallbackLabel("mcp")).toBe("If it does not ask for work for 30 minutes");
    expect(fallbackLabel("model")).toBe("If it is offline for 30 minutes");
  });
});

describe("what an agent will do about sending", () => {
  it("holds an agent worker that is not cleared, and cannot hold an MCP client", () => {
    expect(sendingLine(agent())).toBe("Every request it sends waits for your approval in Review.");
    expect(sendingLine(agent({ kind: "mcp", gate: null, model: null }))).toBe(
      "Drives its own browser. Kick Rocks cannot hold what it sends.",
    );
    expect(
      sendingLine(agent({ gate: { state: "passed", unattended: true, record: null } })),
    ).toBeNull();
  });

  it("adds to the online mark only what it does not already say", () => {
    expect(presenceLine(agent(), NOW)).toBeNull();
    expect(presenceLine(agent({ busy: true, currentTargetName: "Spokeo" }), NOW)).toBe(
      "Busy with Spokeo",
    );
    expect(presenceLine(agent({ online: false, lastSeenAt: minutesAgo(12) }), NOW)).toBe(
      "Seen 12 minutes ago",
    );
    expect(
      presenceLine(
        agent({ kind: "mcp", lastSeenAt: minutesAgo(4), lastClaimAt: minutesAgo(25) }),
        NOW,
      ),
    ).toBe("Last call 4 minutes ago. Last asked for work 25 minutes ago");
    expect(
      presenceLine(agent({ kind: "mcp", lastSeenAt: minutesAgo(4), lastClaimAt: null }), NOW),
    ).toBe("Last call 4 minutes ago. Has not asked for work yet");
  });

  it("counts elapsed time in the unit a person would say", () => {
    expect(elapsedText(minutesAgo(0), NOW)).toBe("less than a minute");
    expect(elapsedText(minutesAgo(1), NOW)).toBe("1 minute");
    expect(elapsedText(minutesAgo(125), NOW)).toBe("2 hours");
    expect(elapsedText(minutesAgo(60 * 24 * 3), NOW)).toBe("3 days");
  });
});

describe("the callout for a task", () => {
  it("invites any agent when none was named, and counts who is online", () => {
    const state = calloutState(
      task(),
      response(agent(), agent({ workerId: "b" }), agent({ workerId: "c", online: false })),
      NOW,
    );
    expect(state).toMatchObject({
      kind: "any",
      title: "Waiting for an agent",
      lines: ["Any connected agent may take it. 2 online."],
      runNow: true,
      needsAttention: true,
    });
  });

  it("offers no Run now when only MCP clients are online", () => {
    const state = calloutState(
      task(),
      response(agent({ kind: "mcp", gate: null, model: null })),
      NOW,
    );
    expect(state.runNow).toBe(false);
  });

  it("says no agent has connected, and points to settings", () => {
    const state = calloutState(task(), response(), NOW);
    expect(state.nobodyConnected).toBe(true);
    expect(state.lines[0]).toMatch(/^No agent has connected yet\./);
  });

  it("names an assignee that is online and idle", () => {
    const state = calloutState(task({ assignment: assignment(model) }), response(agent()), NOW);
    expect(state).toMatchObject({
      kind: "assigned",
      title: "Assigned to nick-pc-agent",
      runNow: true,
      needsAttention: false,
    });
    expect(state.lines).toEqual(["gpt-oss:20b, Not cleared", "Takes it within a few seconds."]);
  });

  it("says what a busy assignee does first", () => {
    const busy = agent({ busy: true, currentTargetName: "Spokeo" });
    const state = calloutState(task({ assignment: assignment(model) }), response(busy), NOW);
    expect(state.lines.at(-1)).toBe("Busy with Spokeo. Takes this next.");
  });

  it("says when an offline assignee's task falls back, and to whom", () => {
    const quiet = agent({ online: false, lastSeenAt: minutesAgo(12) });
    const toAny = calloutState(
      task({ assignment: assignment(model, { at: minutesAgo(20) }) }),
      response(quiet),
      NOW,
    );
    expect(toAny.title).toBe("Assigned to nick-pc-agent, offline");
    expect(toAny.runNow).toBe(false);
    expect(toAny.lines[0]).toMatch(/^Not seen for 12 minutes\. From .+ any agent may take it\.$/);
    const toYou = calloutState(
      task({ assignment: assignment(model, { at: minutesAgo(20), fallback: "person" }) }),
      response(quiet),
      NOW,
    );
    expect(toYou.lines[0]).toMatch(/it comes back to you\.$/);
  });

  it("cannot wake an MCP client, so it shows the line to ask it with", () => {
    const mcp = agent({ kind: "mcp", workerId: "desk-client", gate: null, model: null });
    const state = calloutState(
      task({ assignment: assignment({ kind: "mcp", workerId: "desk-client" }) }),
      response(mcp),
      NOW,
    );
    expect(state).toMatchObject({ mcpHint: true, runNow: false });
    expect(state.lines).toEqual(["MCP clients take work when they call claim_task."]);
  });

  it("says when an MCP client that has not asked for work will lose the task", () => {
    const mcp = agent({
      kind: "mcp",
      workerId: "desk-client",
      gate: null,
      model: null,
      lastClaimAt: null,
    });
    const state = calloutState(
      task({ assignment: assignment({ kind: "mcp", workerId: "desk-client" }) }),
      response(mcp),
      NOW,
    );
    expect(state.lines[1]).toMatch(
      /^Not asked for work yet\. From \d\d:\d\d any agent may take it\.$/,
    );
  });

  it("shows the restore hold instead of promising a quick start", () => {
    const state = calloutState(
      task({ assignment: assignment(model), requestId: "req-1" }),
      response(agent()),
      NOW,
      true,
    );
    expect(state.lines.at(-1)).toMatch(/^Sending is held after a restore/);
  });

  it("uses one pair of presence words per kind of agent", () => {
    expect(presenceWord(agent())).toBe("Online");
    expect(presenceWord(agent({ online: false }))).toBe("Offline");
    expect(presenceWord(agent({ kind: "mcp", online: true }))).toBe("Active");
    expect(presenceWord(agent({ kind: "mcp", online: false }))).toBe("Idle");
  });

  it("says who is working on a leased task, and that it cannot be changed", () => {
    const state = calloutState(
      task({ status: "leased", assignment: assignment(model) }),
      response(agent({ busy: true, currentTargetName: "Spokeo" })),
      NOW,
    );
    expect(state.kind).toBe("working");
    expect(state.title).toBe("nick-pc-agent is working on it");
    expect(state.lines).toEqual([]);
  });

  it("finds the worker on an unassigned leased task by what it is busy with", () => {
    const state = calloutState(
      task({ status: "leased" }),
      response(agent({ busy: true, currentTargetName: "Spokeo" })),
      NOW,
    );
    expect(state.title).toBe("nick-pc-agent is working on it");
  });

  it("tells the person it is theirs when they kept it", () => {
    const state = calloutState(
      task({ assignment: assignment({ kind: "person" }) }),
      response(),
      NOW,
    );
    expect(state).toMatchObject({
      kind: "yours",
      title: "You're doing this one",
      lines: ["No agent will take it."],
    });
  });
});

describe("the lines in lists", () => {
  it("labels who a task is for", () => {
    expect(assignmentLine(null, response(), NOW)).toBe("Any agent");
    expect(assignmentLine(assignment({ kind: "person" }), response(), NOW)).toBe("Yours to do");
    expect(assignmentLine(assignment(model), response(agent()), NOW)).toBe(
      "Assigned to nick-pc-agent",
    );
    expect(assignmentLine(assignment(model), undefined, NOW)).toBe("Assigned to nick-pc-agent");
  });

  it("says when an offline assignee's task moves on", () => {
    const quiet = agent({ online: false, lastSeenAt: minutesAgo(12) });
    expect(assignmentLine(assignment(model, { at: minutesAgo(12) }), response(quiet), NOW)).toMatch(
      /^nick-pc-agent offline, any agent from /,
    );
    expect(
      assignmentLine(
        assignment(model, { at: minutesAgo(12), fallback: "person" }),
        response(quiet),
        NOW,
      ),
    ).toMatch(/^nick-pc-agent offline, back to you from /);
  });

  it("tags only an agent task that is queued or running", () => {
    expect(assigneeTag(task())).toBe("Any agent");
    expect(assigneeTag(task({ assignment: assignment({ kind: "person" }) }))).toBe("You");
    expect(assigneeTag(task({ assignment: assignment(model) }))).toBe("nick-pc-agent");
    expect(assigneeTag(task({ status: "done" }))).toBeNull();
    expect(assigneeTag(task({ kind: "form" }))).toBeNull();
  });
});

describe("what the timeline says about a fallback", () => {
  const event = (payload: Record<string, unknown>): RequestEvent =>
    ({
      id: "e",
      requestId: "r",
      actor: "system",
      createdAt: minutesAgo(1),
      type: "task_assigned",
      payload: { taskId: "tsk_1", by: "fallback", ...payload },
    }) as RequestEvent;

  it("explains why the task is not where it was put", () => {
    const lapsedFrom = model;
    expect(lapsedText([event({ to: "any", lapsedFrom })], "tsk_1")).toBe(
      "nick-pc-agent was offline for 30 minutes, so any agent may take it.",
    );
    expect(lapsedText([event({ to: { kind: "person" }, lapsedFrom })], "tsk_1")).toBe(
      "nick-pc-agent was offline for 30 minutes, so it came back to you.",
    );
  });

  it("says when the agent could no longer take it", () => {
    expect(lapsedText([event({ to: "any", lapsedFrom: model, why: "refused" })], "tsk_1")).toBe(
      "nick-pc-agent can no longer take it, so any agent may take it.",
    );
  });

  it("goes quiet once the person assigned the task again", () => {
    const again = event({ to: model, by: "user" });
    expect(lapsedText([event({ to: "any", lapsedFrom: model }), again], "tsk_1")).toBeNull();
    expect(lapsedText([event({ to: "any", lapsedFrom: model })], "another")).toBeNull();
  });
});

describe("why Run now was refused", () => {
  it("shows the pacing time and the restore hold in words", () => {
    expect(
      runNowRefusal({ code: "site_waiting", message: "x", body: { retryAfterSeconds: 600 } }),
    ).toMatch(/^Kick Rocks is spacing out visits to this site\. It can start from /);
    expect(runNowRefusal({ code: "restore_hold", message: "x" })).toMatch(
      /^Sending is held after a restore/,
    );
    expect(
      runNowRefusal({ code: "no_agent_online", message: "No agent worker is online to take it." }),
    ).toBe("No agent worker is online to take it.");
  });
});
