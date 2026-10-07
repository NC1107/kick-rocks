import { useSyncExternalStore } from "react";
import { readStorage, STORAGE_KEYS, writeStorage } from "./storage.js";

export type ThemePreference = "system" | "light" | "dark";

const listeners = new Set<() => void>();

function readPreference(): ThemePreference {
  const stored = readStorage(STORAGE_KEYS.theme);
  return stored === "light" || stored === "dark" ? stored : "system";
}

let preference: ThemePreference = readPreference();

function notify() {
  for (const listener of listeners) listener();
}

function applyToDocument(next: ThemePreference) {
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (next === "system") root.removeAttribute("data-theme");
  else root.setAttribute("data-theme", next);
}

export function setThemePreference(next: ThemePreference): void {
  preference = next;
  writeStorage(STORAGE_KEYS.theme, next === "system" ? null : next);
  applyToDocument(next);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  const media = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  media?.addEventListener("change", listener);
  return () => {
    listeners.delete(listener);
    media?.removeEventListener("change", listener);
  };
}

function resolve(): "light" | "dark" {
  if (preference !== "system") return preference;
  return globalThis.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export interface ThemeState {
  preference: ThemePreference;
  /** What is on screen, which differs from the preference when it is "system". */
  resolved: "light" | "dark";
  setPreference: (next: ThemePreference) => void;
}

export function useTheme(): ThemeState {
  const current = useSyncExternalStore(
    subscribe,
    () => `${preference}:${resolve()}`,
    () => "system:light",
  );
  const [pref, resolved] = current.split(":") as [ThemePreference, "light" | "dark"];
  return { preference: pref, resolved, setPreference: setThemePreference };
}
