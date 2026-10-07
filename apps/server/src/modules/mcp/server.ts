import {
  BROWSER_TASK_KINDS,
  MCP_TOOLS,
  type McpToolName,
  type TaskKind,
  type TaskStatus,
} from "@kickrocks/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { z } from "zod";
import { AppError } from "../../core/errors.js";
import type { AppServices } from "../../services.js";
import { createRecipeStore } from "../recipes/store.js";
import { createTaskOperations, MCP_CALLER } from "../worker-api/task-operations.js";
import { targetDetail } from "./target-detail.js";

type Input<N extends McpToolName> = z.output<(typeof MCP_TOOLS)[N]["input"]>;
type Output<N extends McpToolName> = z.output<(typeof MCP_TOOLS)[N]["output"]>;

type ToolHandlers = { [N in McpToolName]: (input: Input<N>) => Output<N> };

/** What list_tasks shows when no status is given: work that is waiting or in progress. */
const OPEN_STATUSES: readonly TaskStatus[] = ["queued", "leased", "blocked"];

const isBrowserKind = (kind: TaskKind) => (BROWSER_TASK_KINDS as readonly string[]).includes(kind);

function toolHandlers(services: AppServices): ToolHandlers {
  const operations = createTaskOperations(services, MCP_CALLER);
  const recipes = createRecipeStore(services);
  const { taskQueue } = services;

  return {
    list_tasks({ status, kind, limit }) {
      // The server's own mail and polling work is not for an agent to see or touch.
      if (kind !== undefined && !isBrowserKind(kind)) return { tasks: [] };
      const tasks = taskQueue.list({
        status: status ?? OPEN_STATUSES,
        kinds: kind ? [kind] : BROWSER_TASK_KINDS,
        limit,
      });
      return { tasks: taskQueue.summarize(tasks) };
    },

    claim_task: ({ workerId, kinds, taskId, leaseMs }) => ({
      task: operations.claim({ workerId, kinds, taskId, leaseMs, claimerKind: "mcp" }),
    }),

    heartbeat_task: ({ taskId, ...rest }) => operations.heartbeat(taskId, rest),

    complete_task: ({ taskId, ...rest }) => ({ task: operations.complete(taskId, rest) }),

    block_task: ({ taskId, ...rest }) => ({ task: operations.block(taskId, rest) }),

    fail_task: ({ taskId, ...rest }) => ({ task: operations.fail(taskId, rest) }),

    release_task: ({ taskId, ...rest }) => ({ task: operations.release(taskId, rest) }),

    get_target: ({ targetId }) => targetDetail(services, targetId),

    get_recipe: ({ targetId, purpose }) => {
      services.targets.getOrThrow(targetId);
      return { recipes: recipes.list({ targetId, purpose }) };
    },

    propose_recipe: ({ recipe, notes }) => ({ recipe: recipes.propose({ recipe, notes }) }),
  };
}

function failure(error: { code: string; message?: string; issues?: unknown }): CallToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(error) }],
  };
}

/**
 * Builds an MCP server for one request. Every tool takes and returns the shared schemas, so what
 * an agent sees is the same contract the worker API keeps. A problem the agent can act on, such
 * as a lease it no longer holds or a result of the wrong shape, comes back as a tool error with
 * the same code the REST API uses; anything else is reported without detail.
 */
export function createMcpServer(services: AppServices, version: string): McpServer {
  const server = new McpServer(
    { name: "kick-rocks", version },
    {
      instructions:
        "Kick Rocks tasks for an agent. Claim a task, follow its instructions, and report with complete_task, block_task, or fail_task. Never solve a CAPTCHA, never submit a form for a record the task does not name, and never send personal data anywhere but the page the task points at.",
    },
  );
  const handlers = toolHandlers(services);

  for (const name of Object.keys(MCP_TOOLS) as McpToolName[]) {
    const tool = MCP_TOOLS[name];
    const handler = handlers[name] as (input: unknown) => unknown;
    server.registerTool(
      name,
      {
        description: tool.description,
        inputSchema: tool.input,
        outputSchema: tool.output,
      },
      (async (input: unknown): Promise<CallToolResult> => {
        try {
          const output = tool.output.parse(handler(input)) as Record<string, unknown>;
          return {
            content: [{ type: "text", text: JSON.stringify(output) }],
            structuredContent: output,
          };
        } catch (error) {
          if (error instanceof AppError) {
            return failure({
              code: error.code,
              message: error.message,
              ...(error.issues ? { issues: error.issues } : {}),
            });
          }
          services.logger.error({ err: error, tool: name }, "MCP tool failed");
          return failure({ code: "internal_error", message: "The tool failed unexpectedly" });
        }
      }) as never,
    );
  }
  return server;
}
