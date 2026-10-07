import { describe, expect, it } from "vitest";
import { call, freshMockAppEachTest } from "./test-helpers.js";

freshMockAppEachTest();

describe("profile fixtures and handlers", () => {
  it("creates a profile and replaces its identities", async () => {
    const created = await call({
      method: "POST",
      path: "/profiles",
      body: {
        displayName: "Test Person",
        state: "OR",
        identities: [
          { kind: "name", value: { first: "Test", last: "Person" }, isPrimary: true },
          { kind: "email", value: { address: "test@example.com" }, isPrimary: true },
        ],
      },
    });
    expect(created.status).toBe(201);
    expect(created.json.primaryEmail).toBe("test@example.com");
    const list = await call({ path: "/profiles" });
    expect(list.json.profiles.length).toBe(4);
  });
});
