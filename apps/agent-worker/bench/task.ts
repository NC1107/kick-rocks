// The instructions are the server's own text, so the model reads what a real claim would give it.

import type { ClaimedTask, TargetSummary } from "@kickrocks/shared";
import { BrokerCategory } from "@kickrocks/shared";
import { agentInstructions } from "../../server/dist/core/claim.js";
import { IN_SCOPE_HOST } from "./fixture-server.js";
import { HIDDEN_PROFILE_VALUES, type Scenario } from "./scenarios.js";

export type AgentTask = Extract<ClaimedTask, { kind: "agent" }>;

export function targetFor(scenario: Scenario, origin: string): TargetSummary {
  const url = (path: string | undefined) => (path === undefined ? null : `${origin}${path}`);
  return {
    id: `bench-${scenario.slug}`,
    kind: (BrokerCategory.options as readonly string[]).includes(scenario.target.category)
      ? "broker"
      : "company",
    name: scenario.target.name,
    category: scenario.target.category,
    domain: IN_SCOPE_HOST,
    website: `${origin}/`,
    optOutUrl: url(scenario.paths.optOut),
    privacyRightsUrl: null,
    searchUrl: url(scenario.paths.search),
    contactMethod: "form",
    requiresId: false,
    requirements: [],
    priority: "normal",
    needsRecord: scenario.paths.record !== undefined,
    californiaRegistered: false,
    difficulty: "medium",
    difficultyReasons: [],
    retired: false,
  };
}

/** The claim a worker would receive for the scenario, with the instructions the server writes. */
export function taskFor(scenario: Scenario, origin: string): AgentTask {
  const target = targetFor(scenario, origin);
  const recordUrl =
    scenario.paths.record === undefined ? null : `${origin}${scenario.paths.record}`;
  const fields = {
    ...scenario.fields,
    ...(recordUrl === null ? {} : { record_url: recordUrl }),
  };
  const task = {
    id: `bench-task-${scenario.id}`,
    kind: "agent" as const,
    attempt: 1,
    leaseExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    profileId: "bench-profile",
    target,
    recipe: null,
    fields,
    maskValues: HIDDEN_PROFILE_VALUES,
    // The bench measures what a model does when nothing stops it, which is what the gate asks about.
    submitApproval: "not_needed" as const,
    payload: {
      purpose: scenario.purpose,
      profileId: "bench-profile",
      targetId: target.id,
      requestId: scenario.purpose === "remove" ? "bench-request" : null,
      recordUrl,
      variant: null,
      rights: scenario.rights,
      reason: "no_recipe" as const,
      previousError: null,
      blockedReason: null,
    },
  };
  // The server's function takes its own task record, of which it reads the payload and the lease only.
  const instructions = agentInstructions(
    task as unknown as Parameters<typeof agentInstructions>[0],
    target,
    Object.keys(fields),
  );
  return { ...task, instructions };
}
