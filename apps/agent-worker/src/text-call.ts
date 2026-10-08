import type { ToolCall } from "./provider.js";

/** The end of the object that starts at `from`, or -1 when its braces never close. */
function closeOf(text: string, from: number): number {
  let depth = 0;
  let inString = false;
  for (let i = from; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === "\\") i += 1;
      else if (char === '"') inString = false;
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Every JSON object that is not inside another one, in order. Braces that are not JSON, such as {{city}}, are skipped. */
function topLevelObjects(text: string): unknown[] {
  const found: unknown[] = [];
  for (let i = text.indexOf("{"); i !== -1; i = text.indexOf("{", i + 1)) {
    const end = closeOf(text, i);
    if (end === -1) break;
    try {
      found.push(JSON.parse(text.slice(i, end + 1)));
    } catch {
      // Prose that happens to use braces is not a call.
    }
    i = end;
  }
  return found;
}

const REPORT_STATUSES = new Set(["complete", "blocked", "failed", "release"]);

function bareCall(
  object: Record<string, unknown>,
  toolNames: readonly string[],
  id: string,
): ToolCall | null {
  if ("name" in object) return null;
  if (
    typeof object.status === "string" &&
    REPORT_STATUSES.has(object.status) &&
    toolNames.includes("report")
  ) {
    return { id, name: "report", args: object };
  }
  const keys = Object.keys(object);
  if (keys.length === 1 && keys[0] === "url" && toolNames.includes("navigate")) {
    return { id, name: "navigate", args: object };
  }
  return null;
}

/**
 * A model that writes its tool call as text instead of using the call channel has still said what
 * it wants. When the text holds exactly one JSON object of the form {"name": <an offered tool>,
 * "arguments": {...}}, bare or inside <tool_call> tags, that is the call. Anything else, such as
 * two objects or a name that is no tool, is left for the nudge. A bare object with no name is a
 * call too when it can only be one: a status of complete, blocked, failed or release is a report,
 * and an object whose only key is url is a navigate.
 */
export function toolCallInText(
  text: string,
  toolNames: readonly string[],
  id: string,
): ToolCall | null {
  const objects = topLevelObjects(text.replace(/<\/?tool_call>/gi, " "));
  const [only] = objects;
  if (objects.length !== 1 || typeof only !== "object" || only === null) return null;
  const bare = bareCall(only as Record<string, unknown>, toolNames, id);
  if (bare !== null) return bare;
  const { name, arguments: args } = only as { name?: unknown; arguments?: unknown };
  if (typeof name !== "string" || !toolNames.includes(name)) return null;
  if (typeof args !== "object" || args === null || Array.isArray(args)) return null;
  return { id, name, args };
}
