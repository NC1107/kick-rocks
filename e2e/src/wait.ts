export interface EventuallyOptions {
  timeoutMs?: number;
  intervalMs?: number;
  /** Named in the failure, so a timeout says what never happened. */
  what: string;
}

/** Calls `read` until it returns something other than `undefined` or `false`, or time runs out. */
export async function eventually<T>(
  read: () => Promise<T | undefined | false> | T | undefined | false,
  { timeoutMs = 60_000, intervalMs = 400, what }: EventuallyOptions,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const value = await read();
      if (value !== undefined && value !== false) return value;
    } catch (error) {
      lastError = error;
    }
    if (Date.now() > deadline) {
      const detail = lastError instanceof Error ? ` (last error: ${lastError.message})` : "";
      throw new Error(`Timed out after ${timeoutMs} ms waiting for ${what}${detail}`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
