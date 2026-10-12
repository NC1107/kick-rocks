import {
  BROWSER_TASK_KINDS,
  MCP_TOOLS,
  type McpToolName,
  type TaskKind,
  type TaskStatus,
  type TaskSummary,
} from "@kickrocks/shared";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { AppError } from "../../core/errors.js";
import { targetDetail } from "../../core/target-detail.js";
import type { AppServices } from "../../services.js";
import { createRecipeStore } from "../recipes/store.js";
import { createTaskOperations, MCP_CALLER } from "../worker-api/task-operations.js";

type Input<N extends McpToolName> = z.output<(typeof MCP_TOOLS)[N]["input"]>;
type Output<N extends McpToolName> = z.output<(typeof MCP_TOOLS)[N]["output"]>;

type ToolHandlers = { [N in McpToolName]: (input: Input<N>) => Output<N> };

/** What list_tasks shows when no status is given: work that is waiting or in progress. */
const OPEN_STATUSES: readonly TaskStatus[] = ["queued", "leased", "blocked"];

const isBrowserKind = (kind: TaskKind) => (BROWSER_TASK_KINDS as readonly string[]).includes(kind);

/**
 * A scan or record page a worker got stuck on carries the person's name and city in its address, and
 * list_tasks promises to hold no personal data, so only the site is kept.
 */
function withoutPersonalUrl(summary: TaskSummary): TaskSummary {
  return { ...summary, blockedUrl: summary.blockedUrl ? new URL(summary.blockedUrl).origin : null };
}

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
      return { tasks: taskQueue.summarize(tasks).map(withoutPersonalUrl) };
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

/** A claim_task call that is open to any agent task, which is what an assignment waits for. */
function asksForAgentWork(tool: McpToolName, input: unknown): boolean {
  if (tool !== "claim_task") return false;
  const { taskId, kinds } = input as { taskId?: unknown; kinds?: readonly string[] };
  return taskId === undefined && (kinds?.includes("agent") ?? false);
}

/** Calls the stealth-browser service and returns plain text or a tool error. */
async function browserCall(
  browserUrl: string,
  token: string,
  path: string,
  body?: Record<string, unknown>,
): Promise<CallToolResult> {
  const method = body !== undefined ? "POST" : "GET";
  const url = `${browserUrl}${path}`;
  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers: {
        authorization: `Bearer ${token}`,
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(45_000),
    });
  } catch (err) {
    return failure({
      code: "browser_unavailable",
      message: `Stealth browser unreachable: ${String(err)}`,
    });
  }
  if (res.status === 401)
    return failure({ code: "browser_auth", message: "Stealth browser auth failed" });
  const json = (await res.json()) as Record<string, unknown>;
  if (!res.ok || json["ok"] !== true) {
    return failure({ code: "browser_error", message: String(json["error"] ?? "browser error") });
  }
  const text = typeof json["text"] === "string" ? json["text"] : JSON.stringify(json);
  return { content: [{ type: "text", text }] };
}

/** Captures a screenshot as base64. */
async function browserScreenshot(browserUrl: string, token: string): Promise<CallToolResult> {
  let res: Response;
  try {
    res = await fetch(`${browserUrl}/screenshot`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    });
  } catch (err) {
    return failure({ code: "browser_unavailable", message: String(err) });
  }
  if (!res.ok)
    return failure({ code: "browser_error", message: `screenshot failed: HTTP ${res.status}` });
  const buf = await res.arrayBuffer();
  const data = Buffer.from(buf).toString("base64");
  return { content: [{ type: "image", data, mimeType: "image/png" }] };
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
        const caller = (input as { workerId?: unknown } | undefined)?.workerId;
        if (typeof caller === "string") {
          services.claimers.sawMcp(caller, { askedForWork: asksForAgentWork(name, input) });
        }
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

  const browserUrl = services.config.stealthBrowserUrl;
  const workerToken = services.config.workerToken;
  if (browserUrl !== null && workerToken !== null) {
    const burl = browserUrl;
    const tok = workerToken;

    server.registerTool(
      "browser_navigate",
      {
        description:
          "Open a URL in the stealth browser. Returns the page as an accessibility tree.",
        inputSchema: z.object({
          url: z.string().min(1).max(2000).describe("Full https URL to open."),
        }),
      },
      async ({ url }: { url: string }) => browserCall(burl, tok, "/navigate", { url }),
    );

    server.registerTool(
      "browser_snapshot",
      {
        description:
          "Read the current page's accessibility tree. Pass part for a long page's next section.",
        inputSchema: z.object({
          part: z.number().int().min(1).default(1).describe("Part number (default 1)."),
        }),
      },
      async ({ part }: { part: number }) =>
        browserCall(burl, tok, part > 1 ? `/snapshot?part=${part}` : "/snapshot"),
    );

    server.registerTool(
      "browser_click",
      {
        description: "Click an element by its ref from the latest snapshot.",
        inputSchema: z.object({
          ref: z
            .string()
            .regex(/^e\d{1,5}$/)
            .describe("Ref from the last snapshot, e.g. e12."),
        }),
      },
      async ({ ref }: { ref: string }) => browserCall(burl, tok, "/click", { ref }),
    );

    server.registerTool(
      "browser_fill",
      {
        description: "Type text into an input field by its ref from the latest snapshot.",
        inputSchema: z.object({
          ref: z
            .string()
            .regex(/^e\d{1,5}$/)
            .describe("Ref from the last snapshot."),
          text: z.string().max(10_000).describe("Text to type."),
        }),
      },
      async ({ ref, text }: { ref: string; text: string }) =>
        browserCall(burl, tok, "/fill", { ref, text }),
    );

    server.registerTool(
      "browser_select",
      {
        description: "Choose a dropdown option by its visible label.",
        inputSchema: z.object({
          ref: z
            .string()
            .regex(/^e\d{1,5}$/)
            .describe("Ref of the select element."),
          value: z.string().max(500).describe("Option label to select."),
        }),
      },
      async ({ ref, value }: { ref: string; value: string }) =>
        browserCall(burl, tok, "/select", { ref, value }),
    );

    server.registerTool(
      "browser_screenshot",
      {
        description: "Capture a screenshot of the current page as a PNG.",
        inputSchema: z.object({}),
      },
      async () => browserScreenshot(burl, tok),
    );

    server.registerTool(
      "browser_reset",
      {
        description: "Close the current browser tab and open a fresh one.",
        inputSchema: z.object({}),
      },
      async () => browserCall(burl, tok, "/reset", {}),
    );
  }

  return server;
}
