import { describe, expect, it } from "vitest";
import { MCP_TOOL_NAMES, MCP_TOOLS } from "./mcp.js";

describe("MCP_TOOLS", () => {
  it("exposes the planned tools", () => {
    expect([...MCP_TOOL_NAMES].sort()).toEqual(
      [
        "list_tasks",
        "claim_task",
        "heartbeat_task",
        "complete_task",
        "block_task",
        "fail_task",
        "get_target",
        "get_recipe",
        "propose_recipe",
      ].sort(),
    );
  });

  it("describes every tool so an agent can choose between them", () => {
    for (const name of MCP_TOOL_NAMES)
      expect(MCP_TOOLS[name].description.length, name).toBeGreaterThan(20);
  });

  it("applies defaults to list and claim", () => {
    expect(MCP_TOOLS.list_tasks.input.parse({}).limit).toBe(25);
    expect(MCP_TOOLS.claim_task.input.parse({ workerId: "claude-code" }).leaseMs).toBe(300_000);
  });

  it("only claims browser kinds", () => {
    expect(
      MCP_TOOLS.claim_task.input.safeParse({ workerId: "w", kinds: ["email_send"] }).success,
    ).toBe(false);
    expect(MCP_TOOLS.claim_task.input.safeParse({ workerId: "w", kinds: ["agent"] }).success).toBe(
      true,
    );
  });

  it("requires a task id and worker on every lease-owning tool", () => {
    for (const name of ["heartbeat_task", "complete_task", "block_task", "fail_task"] as const) {
      expect(MCP_TOOLS[name].input.safeParse({}).success, name).toBe(false);
    }
    expect(
      MCP_TOOLS.block_task.input.safeParse({ workerId: "w", taskId: "t", reason: "captcha" })
        .success,
    ).toBe(true);
    expect(
      MCP_TOOLS.fail_task.input.safeParse({
        workerId: "w",
        taskId: "t",
        error: "x",
        retryable: false,
      }).success,
    ).toBe(true);
  });

  it("validates a proposed recipe", () => {
    expect(MCP_TOOLS.propose_recipe.input.safeParse({ recipe: { id: "bad" } }).success).toBe(false);
  });
});
