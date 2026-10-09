import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Skip } from "../types.js";

export const PYTHON_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "python");
export const CACHE_DIR = join(PYTHON_DIR, ".cache");
const VENV_PYTHON = join(PYTHON_DIR, ".venv", "bin", "python");

/** The interpreter of the uv environment under the bench folder, never a system one. */
export function venvPython(): string {
  if (!existsSync(VENV_PYTHON)) {
    throw new Skip("The Python environment is missing; create it with: pnpm bench:replies:python");
  }
  return VENV_PYTHON;
}

export function pythonScript(name: string): string {
  return join(PYTHON_DIR, name);
}

/** Source of a model for a report: the Hugging Face id plus the device it ran on. */
export function deviceLabel(device: "cuda" | "cpu"): string {
  return device === "cuda" ? "GPU" : "CPU";
}
