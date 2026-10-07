import { RequestStatus } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { app, call, freshMockAppEachTest, jordan } from "./test-helpers.js";

freshMockAppEachTest();

describe("dashboard handlers", () => {
  it("shows the effect of a change on the dashboard", async () => {
    const id = jordan().id;
    const before = (await call({ path: `/profiles/${id}/dashboard` })).json;
    const waiting = app.store.requests.find(
      (request) => request.status === "awaiting_reply",
    ) as NonNullable<(typeof app.store.requests)[number]>;
    await call({
      method: "POST",
      path: `/requests/${waiting.id}/actions`,
      body: { action: "mark_confirmed" },
    });
    const after = (await call({ path: `/profiles/${id}/dashboard` })).json;
    expect(after.counts.confirmed).toBe(before.counts.confirmed + 1);
    expect(after.counts.awaiting_reply).toBe(before.counts.awaiting_reply - 1);
    expect(after.total).toBe(before.total);
    expect(Object.keys(after.counts).sort()).toEqual([...RequestStatus.options].sort());
  });
});
