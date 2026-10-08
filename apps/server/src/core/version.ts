import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The version the image build stamped without a leading "v" (the UI adds it for releases), else the server's package.json, which sits two levels above this file in src and in dist. */
export function packageVersion(env: NodeJS.ProcessEnv = process.env): string {
  const stamped = env.KICKROCKS_VERSION?.trim().replace(/^v(?=\d)/i, "");
  if (stamped) return stamped;
  try {
    const file = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}
