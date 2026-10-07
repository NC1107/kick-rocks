import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The server's own version, read from its package.json, which sits two levels above this file in src and in dist. */
export function packageVersion(): string {
  try {
    const file = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "package.json");
    return (JSON.parse(readFileSync(file, "utf8")) as { version: string }).version;
  } catch {
    return "0.0.0";
  }
}
