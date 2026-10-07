import { STACK } from "./stack.js";

export interface FixtureState {
  submissions: { path: string; fields: Record<string, string>; host: string }[];
  tokens: { token: string; record: string; email: string; host: string }[];
  removed: string[];
  confirmed: string[];
  captchaSolved: boolean;
}

export async function fixtureState(): Promise<FixtureState> {
  const response = await fetch(`${STACK.fixtureUrl}/__admin/state`);
  return (await response.json()) as FixtureState;
}

export async function resetFixture(): Promise<void> {
  await fetch(`${STACK.fixtureUrl}/__admin/reset`, { method: "POST" });
}

/** What a person does by hand on the broker's page: pass its CAPTCHA. */
export async function solveFixtureCaptcha(): Promise<void> {
  await fetch(`${STACK.fixtureUrl}/__admin/captcha/solve`, { method: "POST" });
}
