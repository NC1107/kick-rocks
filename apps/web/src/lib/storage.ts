/** Every key the app keeps in localStorage, in one place so none is typed twice. */
export const STORAGE_KEYS = {
  theme: "kickrocks.theme",
  profileId: "kickrocks.profileId",
  gpuSize: "kickrocks.gpuSize",
} as const;

export function readStorage(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    // Storage can throw in a private window or when site data is blocked.
    return null;
  }
}

export function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    // The preference applies for this visit only.
  }
}
