import { describe, expect, it } from "vitest";
import {
  ANSWER_MS,
  answerHolds,
  approveNext,
  chooseDelete,
  clickLabel,
  ctx,
  fill,
  firstLapse,
  giveBack,
  open,
  releasedOf,
  report,
  rowsOf,
  snap,
  startServer,
  typeEmail,
  wait,
  workOnce,
} from "./gate-e2e-harness.js";
import { describeBrowser, fixtureState, type Step } from "./support.js";

describeBrowser("the outgoing gate end to end with the real server", () => {
  describe("a run that differs from what was approved", () => {
    it.each([
      [
        "a different option",
        [
          (v: { ref: (l: string) => string }) => ({
            calls: [["select", { ref: v.ref("Request type"), option: "Access my data" }]],
          }),
        ],
      ],
      [
        "an extra tick",
        [
          (v: { ref: (l: string) => string }) => ({
            calls: [["check", { ref: v.ref("Send me offers"), checked: true }]],
          }),
        ],
      ],
    ])("is held again for %s", async (_, extra) => {
      const taskId = await startServer();
      await firstLapse(taskId);
      expect((await approveNext(taskId)).ok).toBe(true);
      const after = await workOnce(taskId, [
        open("/gate-form"),
        fill,
        chooseDelete,
        ...(extra as Step[]),
        snap,
        clickLabel("Submit request"),
        giveBack,
      ]);
      expect(after).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
    });

    it.each([
      ["a div role=checkbox", "Share my details with partners"],
      ["a type=button toggle", "Include partner brands"],
      ["a role=switch", "Send me alerts"],
      ["an aria-pressed button", "Pin my listing"],
      ["a label that acts like a button", "Sync my other accounts"],
      ["a tab", "Advanced options"],
    ])("is held again when %s flips a hidden field", async (_, control) => {
      const taskId = await startServer("/gate-custom");
      await workOnce(taskId, [open("/gate-custom"), typeEmail, snap, clickLabel("Submit request")]);
      expect((await approveNext(taskId)).ok).toBe(true);
      const after = await workOnce(taskId, [
        open("/gate-custom"),
        snap,
        clickLabel(control),
        typeEmail,
        snap,
        clickLabel("Submit request"),
        giveBack,
      ]);
      expect(after).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
    });
  });

  describe("a request with more fields than are listed", () => {
    it("is not sent on an approval of the shorter one when the next run adds a phone past the listed fields", async () => {
      const taskId = await startServer("/gate-overflow");
      await workOnce(taskId, [
        open("/gate-overflow"),
        typeEmail,
        snap,
        clickLabel("Submit request"),
      ]);
      expect((await approveNext(taskId)).ok).toBe(true);
      const after = await workOnce(taskId, [
        open("/gate-overflow#phone"),
        typeEmail,
        (v) => ({ calls: [["type", { ref: v.ref("Phone number"), field: "phone" }]] }),
        snap,
        clickLabel("Submit request"),
        giveBack,
      ]);
      expect(after.status).not.toBe("done");
      expect((await fixtureState()).submissions).toEqual([]);
      expect(rowsOf(taskId).some((row) => row.kind === "refused")).toBe(true);
    });
  });

  describe("tokens the site changes on every load", () => {
    it("matches a replay whose per-load token differs, and sends it once", async () => {
      const taskId = await startServer("/gate-csrf");
      const steps = [open("/gate-csrf"), typeEmail, snap, clickLabel("Submit request")];
      await workOnce(taskId, steps);
      expect((await approveNext(taskId)).ok).toBe(true);
      const done = await workOnce(taskId, [...steps, report]);
      expect(done.status).toBe("done");
      const { submissions } = await fixtureState();
      expect(submissions).toHaveLength(1);
      expect(submissions[0]?.fields.csrf).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    });

    it("holds a long random value that a click set, which the site did not serve", async () => {
      const taskId = await startServer("/gate-csrf");
      await workOnce(taskId, [open("/gate-csrf"), typeEmail, snap, clickLabel("Submit request")]);
      expect((await approveNext(taskId)).ok).toBe(true);
      const after = await workOnce(taskId, [
        open("/gate-csrf"),
        typeEmail,
        snap,
        clickLabel("Prepare request"),
        clickLabel("Submit request"),
        giveBack,
      ]);
      expect(after).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
    });
  });

  describe("a form with two steps", () => {
    const steps = (): Step[] => [
      open("/gate-step1"),
      typeEmail,
      snap,
      clickLabel("Continue"),
      snap,
      clickLabel("Confirm removal"),
    ];

    it("asks for each step in the same run and finishes after both are approved", async () => {
      const taskId = await startServer("/gate-step1");
      const answered = answerHolds(taskId, ["send", "send"]);
      const done = await workOnce(taskId, [...steps(), report], { holdMs: ANSWER_MS });
      await answered;
      expect(done.status).toBe("done");
      const { submissions } = await fixtureState();
      expect(submissions.map((submission) => submission.path)).toEqual([
        "/gate-step1-post",
        "/gate-step2-post",
      ]);
      expect(releasedOf(taskId)).toHaveLength(2);
    });

    it("sends step 1 again, then step 2, when the run lapsed at step 2 and the next run is approved", async () => {
      const taskId = await startServer("/gate-step1");
      const answered = answerHolds(taskId, ["send", "nobody"]);
      const first = await workOnce(taskId, steps(), { holdMs: 4_000 });
      await answered;
      expect(first).toMatchObject({
        status: "blocked",
        blockedReason: "approval_needed",
        mayHaveSubmitted: true,
      });
      expect((await fixtureState()).submissions.map((s) => s.path)).toEqual(["/gate-step1-post"]);

      expect((await approveNext(taskId)).ok).toBe(true);
      const log = ctx.services.taskSends.gateFor(taskId);
      expect(log.approved.map((entry) => [entry.request.path, entry.resend])).toEqual([
        ["/gate-step1-post", true],
        ["/gate-step2-post", false],
      ]);

      const done = await workOnce(taskId, [...steps(), report]);
      expect(done.status).toBe("done");
      expect((await fixtureState()).submissions.map((s) => s.path)).toEqual([
        "/gate-step1-post",
        "/gate-step1-post",
        "/gate-step2-post",
      ]);
    });
  });

  describe("a value cut into pieces", () => {
    it("holds an email sent as three pieces in one GET, and nothing arrives", async () => {
      const taskId = await startServer("/gate-vectors#pieces");
      const done = await workOnce(taskId, [
        open("/gate-vectors#pieces"),
        typeEmail,
        wait(2),
        snap,
        giveBack,
      ]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      const { hits, submissions } = await fixtureState();
      expect(hits.filter((hit) => hit.path.startsWith("/gate-v-"))).toEqual([]);
      expect(submissions).toEqual([]);
      const carried = rowsOf(taskId).flatMap((row) =>
        row.kind === "held" && "path" in row.request && row.request.path === "/gate-v-pieces"
          ? row.request.carries
          : [],
      );
      expect(carried).toContain("email");
    });
  });

  describe("a form with two steps that is approved one step at a time", () => {
    it("never sends step 2 on the approval of step 1", async () => {
      const taskId = await startServer("/gate-step1");
      const answered = answerHolds(taskId, ["send", "dont_send"]);
      const done = await workOnce(
        taskId,
        [
          open("/gate-step1"),
          typeEmail,
          snap,
          clickLabel("Continue"),
          snap,
          clickLabel("Confirm removal"),
          giveBack,
        ],
        { holdMs: ANSWER_MS },
      );
      await answered;
      expect(done.status).not.toBe("done");
      expect((await fixtureState()).submissions.map((s) => s.path)).toEqual(["/gate-step1-post"]);
      expect(releasedOf(taskId)).toHaveLength(1);
    });
  });

  describe("a page that changes a field as the form goes out", () => {
    const steps = (): Step[] => [
      open("/gate-mutate"),
      typeEmail,
      snap,
      clickLabel("Submit request"),
    ];

    it("sends what the person was shown when they approve it in the run", async () => {
      const taskId = await startServer("/gate-mutate");
      const answered = answerHolds(taskId, ["send"]);
      await workOnce(taskId, [...steps(), report], { holdMs: ANSWER_MS });
      await answered;
      const { submissions } = await fixtureState();
      expect(submissions).toHaveLength(1);
      const held = rowsOf(taskId).find((row) => row.kind === "held");
      const shown = held && "body" in held.request ? held.request.body : [];
      const shownValue = (path: string) => shown.find((entry) => entry.path === path);
      expect(shownValue("note")).toBeDefined();
      expect(submissions[0]?.fields.note).toBe(shownValue("note")?.value);
      expect(submissions[0]?.fields.email).toBe(
        shownValue("email")?.value.replace("{{email}}", "jordan@example.com"),
      );
    });

    it("holds the replay again when the page changed the field in a way the approval did not cover", async () => {
      const taskId = await startServer("/gate-mutate");
      await workOnce(taskId, steps());
      expect((await approveNext(taskId)).ok).toBe(true);
      await new Promise((resolve) => setTimeout(resolve, 20));
      const after = await workOnce(taskId, [...steps(), giveBack]);
      expect(after).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
    });
  });

  describe("the screenshot of a held send", () => {
    function pngHeight(data: Buffer): number {
      return data.readUInt32BE(20);
    }

    it("shows the whole page, with the submit button below the fold", async () => {
      const taskId = await startServer("/gate-long");
      await workOnce(taskId, [open("/gate-long"), typeEmail, snap, clickLabel("Submit request")]);
      const held = rowsOf(taskId).find((row) => row.kind === "held");
      const shot = ctx.services.taskSends.screenshot(taskId, held?.id ?? "");
      expect(shot?.mime).toBe("image/png");
      expect(pngHeight(shot?.data ?? Buffer.alloc(24))).toBeGreaterThan(3_000);
    });

    it("falls back to the part of the page the run acted on when the whole page is too large", async () => {
      const taskId = await startServer("/gate-noisy");
      await workOnce(taskId, [open("/gate-noisy"), typeEmail, snap, clickLabel("Submit request")], {
        maxScreenshotBytes: 400_000,
      });
      const held = rowsOf(taskId).find((row) => row.kind === "held");
      const shot = ctx.services.taskSends.screenshot(taskId, held?.id ?? "");
      expect(shot).not.toBeNull();
      expect(shot?.data.length).toBeLessThanOrEqual(400_000);
      const height = shot?.mime === "image/png" ? pngHeight(shot.data) : 0;
      expect(height).toBeLessThan(1_200);
    });
  });
});
