import type { ApiIssue } from "@kickrocks/shared";

/** The server answered with an error status. */
export class ApiRequestError extends Error {
  override name = "ApiRequestError";

  constructor(
    readonly status: number,
    /** The machine code from the error body, such as "not_found" or "invalid_request". */
    readonly code: string,
    message: string,
    readonly issues: readonly ApiIssue[] = [],
  ) {
    super(message);
  }

  /**
   * Validation problems keyed by dotted path ("identities.0.value.address"), the first message
   * per path. Hand these to the matching Field's error prop.
   */
  get fieldErrors(): Record<string, string> {
    const byPath: Record<string, string> = {};
    for (const issue of this.issues) {
      const key = issue.path.join(".");
      if (!(key in byPath)) byPath[key] = issue.message;
    }
    return byPath;
  }
}

/** The request never got an answer: the server is down, or the network dropped. */
export class ApiNetworkError extends Error {
  override name = "ApiNetworkError";

  constructor(options?: { cause?: unknown }) {
    super("Could not reach the server. Check that Kick Rocks is running, then try again.", options);
  }
}

/** The server answered successfully but the body is not what the shared schema promises. */
export class ApiContractError extends Error {
  override name = "ApiContractError";

  constructor(
    readonly route: string,
    readonly detail: string,
  ) {
    super("The server sent a response this page could not read.");
  }
}

const GENERIC_BY_STATUS: Record<number, string> = {
  400: "Some of the details are not valid.",
  401: "You need to sign in again.",
  403: "That request was blocked.",
  404: "That was not found.",
  409: "That conflicts with the current state. Reload and try again.",
  429: "Too many attempts. Wait a moment, then try again.",
};

export function messageForStatus(status: number): string {
  return GENERIC_BY_STATUS[status] ?? "The server hit a problem. Try again in a moment.";
}

/** Text safe to show a person for any error a request can throw. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof ApiNetworkError || error instanceof ApiContractError) return error.message;
  return "Something went wrong. Try again.";
}
