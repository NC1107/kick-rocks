import { describe, expect, it } from "vitest";
import { app, call, freshMockAppEachTest, jordan } from "./test-helpers.js";

freshMockAppEachTest();

describe("review handlers", () => {
  it("put parked tasks in the review queue", async () => {
    const queue = await call({ path: `/review?profileId=${jordan().id}` });
    expect(queue.json.blockedTasks.length).toBeGreaterThanOrEqual(3);
    expect(queue.json.matches.length).toBeGreaterThanOrEqual(2);
    expect(queue.json.messages.length).toBeGreaterThanOrEqual(2);
  });

  it("resumes, completes, and cancels blocked tasks", async () => {
    const blocked = app.store.tasks.filter((task) => task.status === "blocked");
    const [first, second, third] = blocked;
    const before = await call({ path: "/review" });
    expect(
      (await call({ method: "POST", path: `/tasks/${first?.id}/resume` })).json.task.status,
    ).toBe("queued");
    expect(
      (await call({ method: "POST", path: `/tasks/${second?.id}/mark-done`, body: {} })).json.task
        .status,
    ).toBe("done");
    expect(
      (await call({ method: "POST", path: `/tasks/${third?.id}/cancel` })).json.task.status,
    ).toBe("cancelled");
    const queue = await call({ path: "/review" });
    expect(queue.json.blockedTasks.length).toBe(before.json.blockedTasks.length - 3);
    expect((await call({ method: "POST", path: `/tasks/${first?.id}/resume` })).status).toBe(409);
  });

  it("turns a match decided as mine into a removal request", async () => {
    const match = app.store.matches.find(
      (candidate) => candidate.decision === "pending",
    ) as NonNullable<(typeof app.store.matches)[number]>;
    const decided = await call({
      method: "POST",
      path: `/matches/${match.id}/decision`,
      body: { decision: "mine" },
    });
    expect(decided.json.decision).toBe("mine");
    expect(decided.json.requestId).toBeTruthy();
    const request = await call({ path: `/requests/${decided.json.requestId}` });
    expect(request.json.recordUrl).toBe(match.recordUrl);
    expect(
      (
        await call({
          method: "POST",
          path: `/matches/${match.id}/decision`,
          body: { decision: "not_mine" },
        })
      ).status,
    ).toBe(409);
    const scans = await call({ path: `/profiles/${match.profileId}/scans` });
    const scan = scans.json.items.find((item: { id: string }) => item.id === match.scanId);
    expect(scan.matchCounts.mine).toBe(1);
  });

  it("classifies a message by hand and removes it from the queue", async () => {
    const message = app.store.messages.find((candidate) => !candidate.reviewed) as NonNullable<
      (typeof app.store.messages)[number]
    >;
    const request = app.store.requests[0] as NonNullable<(typeof app.store.requests)[number]>;
    const done = await call({
      method: "POST",
      path: `/messages/${message.id}/classification`,
      body: { classification: "auto_ack", requestId: request.id },
    });
    expect(done.json.classification).toBe("auto_ack");
    expect(done.json.requestId).toBe(request.id);
    const queue = await call({ path: "/review" });
    expect(queue.json.messages.some((item: { id: string }) => item.id === message.id)).toBe(false);
  });

  it("starts scans and refuses to double up", async () => {
    const id = jordan().id;
    const first = await call({
      method: "POST",
      path: `/profiles/${id}/scans`,
      body: { targetIds: ["homerecords"] },
    });
    expect(first.status).toBe(201);
    expect(first.json.items[0].outcome).toBe("scan_started");
    const second = await call({
      method: "POST",
      path: `/profiles/${id}/scans`,
      body: { targetIds: ["homerecords"] },
    });
    expect(second.json.items[0].reason).toBe("scan_in_progress");
  });
});
