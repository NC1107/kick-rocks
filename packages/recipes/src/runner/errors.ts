import type { FailureKind } from "@kickrocks/shared";

/**
 * A run that cannot continue. `recipe` failures are never retryable because the same script would
 * fail the same way; the server hands them to an agent and counts them against the recipe.
 */
export class RunFailure extends Error {
  override name = "RunFailure";

  constructor(
    readonly kind: FailureKind,
    message: string,
    readonly retryable: boolean = kind === "site" || kind === "network",
    public step?: number,
  ) {
    super(message);
  }
}

export function recipeFailure(message: string, step?: number): RunFailure {
  return new RunFailure("recipe", message, false, step);
}

/** Thrown when the caller aborts a run, such as a worker that is shutting down. */
export class RunAborted extends Error {
  override name = "RunAborted";

  constructor() {
    super("The run was aborted");
  }
}

const TRANSIENT = /execution context was destroyed|frame was detached|context was destroyed/i;
const CLOSED = /has been closed|target closed|browser has been closed|browser closed/i;
const NETWORK =
  /net::err_|ns_error_|err_connection|err_name_not_resolved|err_internet_disconnected/i;

/** A page that is mid-navigation answers a query with these, and asking again a moment later works. */
export function isTransientPageError(error: unknown): boolean {
  return error instanceof Error && TRANSIENT.test(error.message) && !CLOSED.test(error.message);
}

export function isClosedError(error: unknown): boolean {
  return error instanceof Error && CLOSED.test(error.message);
}

/** Turns anything thrown while driving a page into a failure with a kind, keeping typed ones as they are. */
export function toFailure(error: unknown): RunFailure {
  if (error instanceof RunFailure) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (NETWORK.test(message)) return new RunFailure("network", firstLine(message), true);
  if (isClosedError(error)) return new RunFailure("internal", "The browser page was closed", true);
  return new RunFailure("internal", firstLine(message), true);
}

function firstLine(message: string): string {
  return (message.split("\n")[0] ?? message).slice(0, 500);
}
