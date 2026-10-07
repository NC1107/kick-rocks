import { RequestStatus } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { app, call, freshMockAppEachTest, jordan } from "./test-helpers.js";

freshMockAppEachTest();

const dashboardOf = async (id: string) => (await call({ path: `/profiles/${id}/dashboard` })).json;

describe("dashboard handlers", () => {
  it("shows the effect of a change on the dashboard", async () => {
    const id = jordan().id;
    const before = await dashboardOf(id);
    const waiting = app.store.requests.find(
      (request) => request.status === "awaiting_reply",
    ) as NonNullable<(typeof app.store.requests)[number]>;
    await call({
      method: "POST",
      path: `/requests/${waiting.id}/actions`,
      body: { action: "mark_confirmed" },
    });
    const after = await dashboardOf(id);
    expect(after.counts.confirmed).toBe(before.counts.confirmed + 1);
    expect(after.counts.awaiting_reply).toBe(before.counts.awaiting_reply - 1);
    expect(after.total).toBe(before.total);
    expect(Object.keys(after.counts).sort()).toEqual([...RequestStatus.options].sort());
  });

  it("counts only the profile's own requests", async () => {
    const riley = app.store.profiles[1] as NonNullable<(typeof app.store.profiles)[number]>;
    const own = app.store.requests.filter((request) => request.profileId === riley.id);
    const { total, counts } = await dashboardOf(riley.id);
    expect(total).toBe(own.length);
    expect(Object.values(counts).reduce((sum: number, count) => sum + (count as number), 0)).toBe(
      own.length,
    );
  });

  it("reports the sending quota against the mailbox cap, and nothing without a mailbox", async () => {
    const withMailbox = await dashboardOf(jordan().id);
    expect(withMailbox.sending.cap).toBe(jordan().mailbox?.dailyCap);
    expect(withMailbox.sending.sent + withMailbox.sending.remaining).toBe(withMailbox.sending.cap);
    expect(withMailbox.mailbox.address).toBe("jordan@example.com");

    const riley = app.store.profiles[1] as NonNullable<(typeof app.store.profiles)[number]>;
    const without = await dashboardOf(riley.id);
    expect(without.sending).toBeNull();
    expect(without.mailbox).toBeNull();
  });

  it("never reports more remaining than the cap, or less than zero", async () => {
    const mailbox = jordan().mailbox;
    if (mailbox) mailbox.dailyCap = 1;
    const { sending } = await dashboardOf(jordan().id);
    expect(sending.remaining).toBe(0);
    expect(sending.sent).toBeGreaterThan(0);
  });

  it("carries the mailbox error so the page can show it", async () => {
    const mailbox = jordan().mailbox;
    if (mailbox) mailbox.lastError = "Login failed";
    expect((await dashboardOf(jordan().id)).mailbox.lastError).toBe("Login failed");
  });

  it("lists recent events newest first, at most twelve, with a reference and a target name", async () => {
    const { recentEvents } = await dashboardOf(jordan().id);
    expect(recentEvents.length).toBeGreaterThan(0);
    expect(recentEvents.length).toBeLessThanOrEqual(12);
    const times = recentEvents.map((event: { createdAt: string }) => event.createdAt);
    expect(times).toEqual([...times].sort().reverse());
    for (const event of recentEvents) {
      expect(event.requestReference).toMatch(/^KR-[0-9A-Z]{6}$/);
      expect(event.targetName.length).toBeGreaterThan(0);
    }
  });

  it("counts what needs attention from tasks, matches, messages, and requests", async () => {
    const { attention, counts } = await dashboardOf(jordan().id);
    expect(attention.needsVerification).toBe(counts.needs_verification);
    for (const value of Object.values(attention)) expect(value).toBeGreaterThanOrEqual(0);
  });

  it("answers 404 for a profile that does not exist", async () => {
    expect((await call({ path: "/profiles/nope/dashboard" })).status).toBe(404);
  });
});
