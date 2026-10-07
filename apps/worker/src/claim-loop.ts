import { NotImplementedError } from "@kickrocks/shared";
import type { WorkerApiClient } from "./api-client.js";
import type { WorkerConfig } from "./config.js";

export interface ClaimLoopContext {
  config: WorkerConfig;
  client: WorkerApiClient;
  signal: AbortSignal;
}

/**
 * Claims one task at a time, keeps its lease alive, runs it, and reports the outcome.
 * Left unimplemented on purpose: a stub that claimed tasks it cannot run would burn their attempts.
 */
export function runClaimLoop(_context: ClaimLoopContext): Promise<void> {
  throw new NotImplementedError("the worker claim loop");
}
