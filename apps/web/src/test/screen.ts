import { vi } from "vitest";

/** Makes the screen a phone for the rest of the test; the dom project restores it after each test. */
export function stubPhone(): void {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}
