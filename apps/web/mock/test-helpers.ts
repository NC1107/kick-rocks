import { CSRF_HEADER, CSRF_HEADER_VALUE } from "@kickrocks/shared";
import { beforeEach } from "vitest";
import { createMockApp, type MockApp, type MockAppOptions, type MockRequest } from "./app.js";

/** The mock app of the current test, replaced with a fresh one before each. */
export let app: MockApp;

/** Call once at the top of a test file: every test then starts from the fixtures. */
export function freshMockAppEachTest(): void {
  beforeEach(() => {
    app = createMockApp();
  });
}

/** Replaces the app mid-test, for a test that needs it signed out or not yet set up. */
export function resetApp(options?: MockAppOptions): void {
  app = createMockApp(options);
}

export interface Call {
  method?: string;
  path: string;
  body?: unknown;
  csrf?: boolean;
}

export async function call({ method = "GET", path, body, csrf = method !== "GET" }: Call) {
  const request: MockRequest = {
    method,
    url: `/api${path}`,
    headers: csrf ? { [CSRF_HEADER]: CSRF_HEADER_VALUE } : {},
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  const response = await app.handle(request);
  const text = typeof response.body === "string" ? response.body : "";
  return {
    status: response.status,
    headers: response.headers,
    json: text ? JSON.parse(text) : null,
    raw: response.body,
  };
}

export const jordan = () =>
  app.store.profiles[0] as NonNullable<(typeof app.store.profiles)[number]>;
