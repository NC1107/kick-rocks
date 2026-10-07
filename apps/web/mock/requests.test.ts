import { RequestStatus } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { app, call, freshMockAppEachTest, jordan } from "./test-helpers.js";

freshMockAppEachTest();

describe("request handlers", () => {
  it("show every request status on the first profile, so every pill can be seen", () => {
    const seen = new Set(
      app.store.requests.filter((r) => r.profileId === jordan().id).map((r) => r.status),
    );
    expect([...seen].sort()).toEqual([...RequestStatus.options].sort());
  });

  it("filters, searches, and pages the request list", async () => {
    const id = jordan().id;
    const sent = await call({ path: `/profiles/${id}/requests?status=sent,queued` });
    expect(
      sent.json.items.every((item: { status: string }) => ["sent", "queued"].includes(item.status)),
    ).toBe(true);
    const paged = await call({ path: `/profiles/${id}/requests?pageSize=5&page=2` });
    expect(paged.json.items.length).toBe(5);
    expect(paged.json.page).toBe(2);
    const found = await call({ path: `/profiles/${id}/requests?q=audience` });
    expect(found.json.total).toBe(1);
  });

  it("applies actions through the state machine", async () => {
    const queued = app.store.requests.find((request) => request.status === "queued") as NonNullable<
      (typeof app.store.requests)[number]
    >;
    const cancelled = await call({
      method: "POST",
      path: `/requests/${queued.id}/actions`,
      body: { action: "cancel" },
    });
    expect(cancelled.json.status).toBe("cancelled");
    expect(cancelled.json.events.at(-1).type).toBe("status_changed");
    const again = await call({
      method: "POST",
      path: `/requests/${queued.id}/actions`,
      body: { action: "mark_confirmed" },
    });
    expect(again.status).toBe(409);

    const bounced = app.store.requests.find(
      (request) => request.status === "bounced",
    ) as NonNullable<(typeof app.store.requests)[number]>;
    const resent = await call({
      method: "POST",
      path: `/requests/${bounced.id}/actions`,
      body: { action: "resend" },
    });
    expect(resent.json.status).toBe("queued");
  });
});
