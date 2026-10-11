import { orderNeedsYou } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { buildMockNeedsYou } from "./review.js";
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

describe("needs-you handlers", () => {
  const queueOf = async () =>
    (await call({ path: `/needs-you?profileId=${jordan().id}` })).json as {
      items: { key: string; kind: string; tries: number; openedAt: string | null; order: number }[];
      snoozed: { key: string }[];
      counts: { active: number; snoozed: number };
    };

  it("lists what waits on the person in the order the shared function gives", async () => {
    const queue = await queueOf();
    const profile = jordan();
    const direct = orderNeedsYou(buildMockNeedsYou(app.store, profile.id).items, new Date());
    expect(queue.items.map((item) => item.key)).toEqual(direct.map((item) => item.key));
    expect(queue.items[0]?.kind).toBe("hold");
    expect(queue.items.map((item) => item.order)).toEqual(queue.items.map((_, index) => index));
    expect(new Set(queue.items.map((item) => item.kind))).toEqual(
      new Set([
        "hold",
        "approve",
        "check_sent",
        "captcha",
        "phone_code",
        "id",
        "email_link",
        "login",
        "bot",
        "by_hand",
        "record",
        "details",
      ]),
    );
  });

  it("snoozes an item until the time asked, and gives it back after", async () => {
    const target = (await queueOf()).items.find((item) => item.kind === "captcha");
    const [kind, id] = (target?.key ?? "").split(":");
    const until = new Date(Date.now() + 3_600_000).toISOString();
    const done = await call({
      method: "POST",
      path: `/needs-you/${kind}/${id}/snooze`,
      body: { until },
    });
    expect(done.json.snoozedUntil).toBe(until);
    const hidden = await queueOf();
    expect(hidden.items.some((item) => item.key === target?.key)).toBe(false);
    expect(hidden.snoozed.map((item) => item.key)).toEqual([target?.key]);
    expect(hidden.counts.snoozed).toBe(1);
    await call({ method: "DELETE", path: `/needs-you/${kind}/${id}/snooze` });
    expect((await queueOf()).items.some((item) => item.key === target?.key)).toBe(true);
  });

  it("refuses a past time, a time more than 30 days away, and a held request", async () => {
    const queue = await queueOf();
    const captcha = queue.items.find((item) => item.kind === "captcha")?.key.split(":") ?? [];
    const hold = queue.items.find((item) => item.kind === "hold")?.key.split(":") ?? [];
    const snooze = (key: string[], until: Date) =>
      call({
        method: "POST",
        path: `/needs-you/${key[0]}/${key[1]}/snooze`,
        body: { until: until.toISOString() },
      });
    expect((await snooze(captcha, new Date(Date.now() - 1_000))).status).toBe(400);
    expect((await snooze(captcha, new Date(Date.now() + 31 * 86_400_000))).status).toBe(400);
    expect((await snooze(hold, new Date(Date.now() + 3_600_000))).status).toBe(409);
  });

  it("counts a try, writes it on the timeline, and puts the item behind untried ones", async () => {
    const before = await queueOf();
    const first = before.items.find((item) => item.kind === "captcha");
    const [kind, id] = (first?.key ?? "").split(":");
    const result = await call({
      method: "POST",
      path: `/needs-you/${kind}/${id}/not-yet`,
      body: {},
    });
    expect(result.json.tries).toBe(1);
    const after = await queueOf();
    const index = (queue: typeof before) =>
      queue.items.findIndex((item) => item.key === first?.key);
    expect(index(after)).toBeGreaterThan(index(before));
    expect(after.items[index(after)]?.tries).toBe(1);
    const task = app.store.tasks.find((candidate) => candidate.id === id);
    const request = app.store.requests.find((candidate) => candidate.id === task?.requestId);
    expect(request?.events.at(-1)).toMatchObject({
      type: "user_action",
      payload: { action: "not_yet" },
    });
  });

  it("remembers that the page was opened, and forgets it once the task is done", async () => {
    const target = (await queueOf()).items.find((item) => item.kind === "captcha");
    const [kind, id] = (target?.key ?? "").split(":");
    const opened = await call({ method: "POST", path: `/needs-you/${kind}/${id}/opened` });
    expect(opened.json.openedAt).toBeTruthy();
    expect((await queueOf()).items.find((item) => item.key === target?.key)?.openedAt).toBeTruthy();
    await call({ method: "POST", path: `/tasks/${id}/mark-done`, body: {} });
    expect(app.store.needsYouMarks.get(target?.key ?? "")?.openedAt ?? null).toBeNull();
  });

  it("answers 404 for an item that is unknown and 409 for one that is done", async () => {
    expect((await call({ method: "POST", path: "/needs-you/task/nope/opened" })).status).toBe(404);
    const target = (await queueOf()).items.find((item) => item.kind === "captcha");
    const [kind, id] = (target?.key ?? "").split(":");
    await call({ method: "POST", path: `/tasks/${id}/mark-done`, body: {} });
    expect(
      (await call({ method: "POST", path: `/needs-you/${kind}/${id}/not-yet`, body: {} })).status,
    ).toBe(409);
  });
});
