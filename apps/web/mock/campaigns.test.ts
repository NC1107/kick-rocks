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

  it("states only the chosen rights in the preview basis sentence", async () => {
    const preview = async (rights: string[]) =>
      (
        await call({
          method: "POST",
          path: `/profiles/${jordan().id}/campaigns/preview`,
          body: { selection: { preset: "email_brokers" }, rights },
        })
      ).json.sampleEmail.text as string;

    const optOut = await preview(["opt_out"]);
    expect(optOut).toContain("the right to opt out of the sale or sharing");
    expect(optOut).not.toContain("delete the personal information you hold about me.");
    expect(optOut).toContain("does not need identity verification for an opt-out");
    const both = await preview(["opt_out", "delete"]);
    expect(both).toContain(
      "the right to ask you to delete the personal information you hold about me",
    );
    const deleteOnly = await preview(["delete"]);
    expect(deleteOnly).toContain(
      "the right to ask you to delete the personal information you hold about me",
    );
    expect(deleteOnly).not.toContain("delete it");
    expect(deleteOnly).not.toContain("identity verification for an opt-out");
    expect(deleteOnly).toContain("If you need to verify me before deleting");
  });

  it("selects every easy target with the easy preset and the same ones by filter", async () => {
    const easy = (await call({ path: "/targets?difficulty=easy&pageSize=1" })).json.total;
    const path = `/profiles/${jordan().id}/campaigns/preview`;
    const rights = ["opt_out"];
    const preset = await call({
      method: "POST",
      path,
      body: { selection: { preset: "easy" }, rights },
    });
    const filter = await call({
      method: "POST",
      path,
      body: { selection: { filter: { difficulty: "easy" } }, rights },
    });
    expect(preset.json.items).toHaveLength(easy);
    expect(filter.json.items.map((item: { targetId: string }) => item.targetId).sort()).toEqual(
      preset.json.items.map((item: { targetId: string }) => item.targetId).sort(),
    );
  });

  it("starts scans for the people-search targets a filter selects", async () => {
    const riley = app.store.profiles[1] as NonNullable<(typeof app.store.profiles)[number]>;
    const scanned = await call({
      method: "POST",
      path: `/profiles/${riley.id}/scans`,
      body: { filter: { category: "people-search" } },
    });
    expect(scanned.status).toBeLessThan(300);
    expect(scanned.json.items.length).toBeGreaterThan(0);
  });

  it("names the first emailed target in the sample, even in a mixed group", async () => {
    const preview = await call({
      method: "POST",
      path: `/profiles/${jordan().id}/campaigns/preview`,
      body: { selection: { preset: "everything" }, rights: ["opt_out"] },
    });
    const emailed = preview.json.items.find((item: { outcome: string; targetId: string }) => {
      const target = app.store.targets.find((candidate) => candidate.id === item.targetId);
      return (
        item.outcome === "request_created" &&
        (target?.contactMethod === "email" || target?.contactMethod === "both")
      );
    });
    expect(preview.json.sampleEmail.subject).toContain(emailed.targetName);
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
