import type { ApiIssue } from "@kickrocks/shared";

/**
 * An error the caller should see, with the HTTP status and the machine readable code the API
 * returns. Anything else that escapes a route is an internal error and is reported as one.
 */
export class AppError extends Error {
  override name = "AppError";

  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues?: ApiIssue[],
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export function notFound(message: string, code = "not_found"): AppError {
  return new AppError(404, code, message);
}

export function conflict(code: string, message: string): AppError {
  return new AppError(409, code, message);
}

export function invalidRequest(message: string, issues?: ApiIssue[]): AppError {
  return new AppError(400, "invalid_request", message, issues);
}
