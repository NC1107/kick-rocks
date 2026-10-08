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

function setThemePreference(next: ThemePreference): void {
  preference = next;
  writeStorage(STORAGE_KEYS.theme, next === "system" ? null : next);
  applyToDocument(next);
  notify();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

interface ThemeState {
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
}

export function useTheme(): ThemeState {
  const current = useSyncExternalStore(
    subscribe,
    () => preference,
    () => "system" as const,
  );
  return { preference: current, setPreference: setThemePreference };
}
