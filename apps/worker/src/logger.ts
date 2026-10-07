export type LogLevel = "debug" | "info" | "warn" | "error";

const ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  debug(message: string, fields?: LogFields): void;
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export type LogSink = (line: string) => void;

/**
 * One line per event, with fields as JSON. Callers pass ids, kinds, and outcomes only: a task's
 * fields hold the person's details, so nothing here ever receives them.
 */
export function createLogger(
  level: LogLevel,
  sink: LogSink = (line) => process.stderr.write(`${line}\n`),
  now: () => Date = () => new Date(),
): Logger {
  const write = (at: LogLevel, message: string, fields?: LogFields) => {
    if (ORDER[at] < ORDER[level]) return;
    const extra = fields && Object.keys(fields).length > 0 ? ` ${JSON.stringify(fields)}` : "";
    sink(`${now().toISOString()} ${at.toUpperCase().padEnd(5)} ${message}${extra}`);
  };
  return {
    debug: (message, fields) => write("debug", message, fields),
    info: (message, fields) => write("info", message, fields),
    warn: (message, fields) => write("warn", message, fields),
    error: (message, fields) => write("error", message, fields),
  };
}

export const silentLogger: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
};

export function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return (message.split("\n")[0] ?? message).slice(0, 300);
}
