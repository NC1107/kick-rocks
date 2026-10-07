import { describe, expect, it } from "vitest";
import { app, call, freshMockAppEachTest, jordan } from "./test-helpers.js";

freshMockAppEachTest();

describe("campaign handlers", () => {
  it("previews and creates a campaign, skipping what is already active", async () => {
    const body = { selection: { preset: "email_brokers" }, rights: ["opt_out"] };
    const preview = await call({
      method: "POST",
      path: `/profiles/${jordan().id}/campaigns/preview`,
      body,
    });
    expect(preview.status).toBe(200);
    expect(preview.json.counts.request_created).toBeGreaterThan(0);
    expect(preview.json.counts.skipped).toBeGreaterThan(0);
    expect(preview.json.sampleEmail.subject).toContain("KR-");

    const before = (await call({ path: `/profiles/${jordan().id}/requests?pageSize=200` })).json
      .total;
    const created = await call({
      method: "POST",
      path: `/profiles/${jordan().id}/campaigns`,
      body,
    });
    expect(created.status).toBe(201);
    const after = (await call({ path: `/profiles/${jordan().id}/requests?pageSize=200` })).json
      .total;
    expect(after - before).toBe(created.json.counts.request_created);

    const again = await call({
      method: "POST",
      path: `/profiles/${jordan().id}/campaigns/preview`,
      body,
    });
    expect(again.json.counts.request_created).toBe(0);
  });

  it("starts a scan for a people-search target instead of sending a request", async () => {
    const riley = app.store.profiles[1] as NonNullable<(typeof app.store.profiles)[number]>;
    const body = { selection: { targetIds: ["peopletrace"] }, rights: ["delete"] };
    const preview = await call({
      method: "POST",
      path: `/profiles/${riley.id}/campaigns/preview`,
      body,
    });
    expect(preview.json.items[0].outcome).toBe("scan_started");
  });

  it("skips a scan the profile has no address to run", async () => {
    const riley = app.store.profiles[1] as NonNullable<(typeof app.store.profiles)[number]>;
    riley.identities = riley.identities.filter((identity) => identity.kind !== "address");
    const preview = await call({
      method: "POST",
      path: `/profiles/${riley.id}/campaigns/preview`,
      body: { selection: { targetIds: ["peopletrace"] }, rights: ["delete"] },
    });
    expect(preview.json.items[0]).toMatchObject({
      outcome: "skipped",
      reason: "missing_profile_details",
    });
  });
});
