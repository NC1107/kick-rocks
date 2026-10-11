import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The version the image build stamped without a leading "v", else the worker's package version; "unknown" when neither can be read. */
export function readWorkerVersion(env: NodeJS.ProcessEnv = process.env): string {
  const stamped = env.KICKROCKS_VERSION?.trim().replace(/^v(?=\d)/i, "");
  if (stamped) return stamped;
  try {
    const file = resolve(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    const version = (parsed as { version?: unknown }).version;
    return typeof version === "string" ? version : "unknown";
  } catch {
    return "unknown";
  }
}
