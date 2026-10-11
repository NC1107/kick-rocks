import { describe, expect, it } from "vitest";
import {
  ANSWER_MS,
  giveBack,
  open,
  rowsOf,
  runContext,
  snap,
  startServer,
  typeEmail,
  wait,
  workOnce,
} from "./gate-e2e-harness.js";
import { describeBrowser, fixtureState, type Step } from "./support.js";

describeBrowser("the outgoing gate end to end with the real server", () => {
  describe("one page, one way out for the email", () => {
    const heldPaths = (taskId: string) =>
      rowsOf(taskId)
        .filter((row) => row.kind === "held")
        .map((row) => ("path" in row.request ? row.request.path : ""));

    const carriedBy = (taskId: string, path: string) =>
      rowsOf(taskId).flatMap((row) =>
        row.kind === "held" && "path" in row.request && row.request.path === path
          ? row.request.carries
          : [],
      );

    /** Nothing the vector page asked of the site reached it, whatever it carried. */
    async function expectNothingArrived(): Promise<void> {
      const { hits, submissions } = await fixtureState();
      expect(hits.filter((hit) => hit.path.startsWith("/gate-v-"))).toEqual([]);
      expect(submissions).toEqual([]);
    }

    async function stopsForApproval(vector: string, steps: Step[]) {
      const taskId = await startServer(`/gate-vectors#${vector}`);
      const done = await workOnce(taskId, [open(`/gate-vectors#${vector}`), ...steps]);
      await expectNothingArrived();
      return { taskId, done };
    }

    it.each([
      ["css", "a background image set from script", "/gate-v-css"],
      ["font", "a web font loaded from script", "/gate-v-font"],
      ["eventsource", "an event stream", "/gate-v-sse"],
      ["refresh", "a meta refresh to an address with the value", "/gate-v-refresh"],
      ["pushstate", "a pushState followed by a reload", "/gate-v-push"],
      ["srcdoc", "a srcdoc frame that posts", "/gate-v-srcdoc"],
      ["timer", "a fetch five seconds after typing", "/gate-v-timer"],
    ])("stops for approval at %s: %s", async (vector, _, path) => {
      const { taskId, done } = await stopsForApproval(vector, [
        typeEmail,
        wait(vector === "timer" ? 7 : 2),
        snap,
        giveBack,
      ]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect(heldPaths(taskId)).toContain(path);
      expect(JSON.stringify(rowsOf(taskId).map((row) => row.request))).not.toContain(
        "jordan@example.com",
      );
    });

    it("opens no new tab for a form aimed at one, so the post is never made and nothing is asked", async () => {
      const taskId = await startServer("/gate-vectors#blank");
      let transcript = "";
      let after = 0;
      let before = 0;
      const done = await workOnce(taskId, [
        open("/gate-vectors#blank"),
        () => {
          before = runContext?.pages().length ?? 0;
          return { calls: [["snapshot", {}]] };
        },
        typeEmail,
        wait(2),
        wait(2),
        (view) => {
          transcript = view.transcript;
          after = runContext?.pages().length ?? 0;
          return giveBack;
        },
      ]);
      // The script appends its form just before submitting it, so the field is proof it ran that far.
      expect(transcript).toContain(`textbox "e"`);
      // The refused tab is reported, so the submit did ask for one, and no page is left beside the ones the run began with.
      expect(transcript).toContain("Blocked a navigation: A new tab or window cannot be opened");
      expect(after).toBe(before);
      await expectNothingArrived();
      expect(done.status).toBe("queued");
      expect(rowsOf(taskId).filter((row) => row.kind === "held")).toEqual([]);
    });

    it("stops a beacon sent on pagehide, which only goes out as the run ends", async () => {
      const taskId = await startServer("/gate-vectors#pagehide");
      await workOnce(taskId, [open("/gate-vectors#pagehide"), typeEmail, giveBack]);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      await expectNothingArrived();
      const rows = rowsOf(taskId).filter(
        (row) => "path" in row.request && row.request.path === "/gate-v-pagehide",
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.kind === "held" || row.kind === "refused")).toBe(true);
    });

    // The profile's hidden first and last names are substrings of the email, so a request is held for
    // them whether or not the gate recognises the email. Only the carried field shows which one did it.
    it.each([
      { vector: "trimmed", how: "with spaces around it" },
      { vector: "lowercased", how: "in capitals" },
      { vector: "base64", how: "as base64" },
      { vector: "reversed", how: "written backwards" },
      { vector: "sha256", how: "as a sha256 hash" },
    ])("stops for approval, as the email, when the value is sent $how", async ({ vector }) => {
      const { taskId, done } = await stopsForApproval(vector, [typeEmail, wait(2), snap, giveBack]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect(carriedBy(taskId, `/gate-v-${vector}`)).toContain("email");
    });

    it("refuses an image GET that follows 101 cookies, the last of which holds the email", async () => {
      const taskId = await startServer("/gate-vectors#cookies");
      const done = await workOnce(taskId, [
        open("/gate-vectors#cookies"),
        typeEmail,
        wait(2),
        snap,
        giveBack,
      ]);
      expect(done.status).not.toBe("done");
      await expectNothingArrived();
      const rows = rowsOf(taskId).filter(
        (row) => "path" in row.request && row.request.path === "/gate-v-cookies",
      );
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.kind === "refused")).toBe(true);
    });

    it("stops for approval, as the email, when it is base64 after 64 decoy tokens", async () => {
      const { taskId, done } = await stopsForApproval("tokens", [
        typeEmail,
        wait(2),
        snap,
        giveBack,
      ]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect(carriedBy(taskId, "/gate-v-tokens")).toContain("email");
    });

    // The gate does not put the halves back together, but the domain half holds a run of the address.
    it("stops for approval, as an email, when the value is sent split at the @ into two fields", async () => {
      const { taskId, done } = await stopsForApproval("split", [
        typeEmail,
        wait(2),
        snap,
        giveBack,
      ]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect(carriedBy(taskId, "/gate-v-split")).toEqual(["email", "other"]);
    });
  });

  describe("a request the browser sends when its session goes away", () => {
    const refusedNotHoldable = (taskId: string, path: string) =>
      rowsOf(taskId).filter(
        (row) =>
          row.kind === "refused" &&
          row.reason === "not_holdable" &&
          "path" in row.request &&
          row.request.path === path,
      );

    async function nothingArrived(): Promise<void> {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const { hits, submissions } = await fixtureState();
      expect(hits.filter((hit) => hit.path.startsWith("/gate-v-ka-"))).toEqual([]);
      expect(submissions).toEqual([]);
    }

    it("refuses a beacon of a cross-site frame at once, so removing the frame sends nothing", async () => {
      const taskId = await startServer("/gate-keepalive#frame", true);
      await workOnce(taskId, [open("/gate-keepalive#frame"), typeEmail, wait(2), giveBack], {
        holdMs: ANSWER_MS,
      });
      await nothingArrived();
      expect(refusedNotHoldable(taskId, "/gate-v-ka-frame").length).toBeGreaterThan(0);
      expect(rowsOf(taskId).filter((row) => row.kind === "held")).toEqual([]);
    });

    it("refuses a beacon of the top page instead of holding it", async () => {
      const taskId = await startServer("/gate-keepalive#beacon");
      await workOnce(taskId, [open("/gate-keepalive#beacon"), typeEmail, wait(2), giveBack], {
        holdMs: ANSWER_MS,
      });
      await nothingArrived();
      expect(refusedNotHoldable(taskId, "/gate-v-ka-beacon").length).toBeGreaterThan(0);
    });

    it("sends nothing from a keepalive fetch the top page makes as the run closes", async () => {
      const taskId = await startServer("/gate-keepalive#pagehide");
      await workOnce(taskId, [open("/gate-keepalive#pagehide"), typeEmail, giveBack]);
      await nothingArrived();
    });

    for (const vector of ["request", "freshframe", "later"]) {
      it(`makes a keepalive request of the ${vector} kind an ordinary one, so ending the run sends nothing`, async () => {
        const taskId = await startServer(`/gate-keepalive#${vector}`);
        await workOnce(taskId, [open(`/gate-keepalive#${vector}`), typeEmail, wait(2), giveBack], {
          holdMs: ANSWER_MS,
        });
        await nothingArrived();
      });
    }

    it("logs a keepalive fetch that was made an ordinary request", async () => {
      const taskId = await startServer("/gate-keepalive#fetch");
      await workOnce(taskId, [open("/gate-keepalive#fetch"), typeEmail, wait(2), giveBack], {
        holdMs: ANSWER_MS,
      });
      await nothingArrived();
      expect(
        rowsOf(taskId).some((row) => row.kind === "guard_event" && row.reason === "keepalive"),
      ).toBe(true);
    });

    it("sends nothing from a keepalive fetch that was still waiting for a person when the run ended", async () => {
      const taskId = await startServer("/gate-keepalive#fetch");
      await workOnce(taskId, [open("/gate-keepalive#fetch"), typeEmail, wait(2), giveBack], {
        holdMs: ANSWER_MS,
      });
      await nothingArrived();
    });
  });
});
