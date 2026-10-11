import { API_ROUTES } from "@kickrocks/shared";
import { describe, expect, it, vi } from "vitest";
import { ORIGIN } from "./fixtures/server.js";
import {
  ANSWER_MS,
  answerHolds,
  approveNext,
  browser,
  clickLabel,
  ctx,
  decideRow,
  firstLapse,
  giveBack,
  open,
  releasedOf,
  report,
  rowsOf,
  runContext,
  snap,
  startServer,
  submitSteps,
  typeEmail,
  wait,
  workOnce,
} from "./gate-e2e-harness.js";
import { describeBrowser, fixtureState, resetFixture, type Step } from "./support.js";

describeBrowser("the outgoing gate end to end with the real server", () => {
  describe("a baseline run", () => {
    it("holds the form, sends exactly the request that was captured once a person says send, and finishes", async () => {
      const taskId = await startServer();
      const answered = answerHolds(taskId, ["send"]);
      const done = await workOnce(taskId, [...submitSteps(), report], { holdMs: ANSWER_MS });
      await answered;

      expect(done).toMatchObject({
        status: "done",
        mayHaveSubmitted: true,
        submitApproval: "required",
      });
      const { submissions } = await fixtureState();
      expect(submissions).toHaveLength(1);
      expect(submissions[0]).toMatchObject({
        path: "/gate-optout",
        fields: {
          kind: "delete",
          action: "optout",
          share: "no",
          scope: "this-site",
          email: "jordan@example.com",
        },
      });
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      expect(held).toHaveLength(1);
      expect(held[0]).toMatchObject({ status: "sent", decidedBy: "user", hasScreenshot: true });
      const released = releasedOf(taskId);
      expect(released).toHaveLength(1);
      expect(released[0]).toMatchObject({ status: "sent", responseStatus: 200 });
      const request = released[0]?.request;
      expect(
        request && "body" in request ? request.body.map((value) => value.path).sort() : [],
      ).toEqual(Object.keys(submissions[0]?.fields ?? {}).sort());
    });

    it("shows the person's values in a held request where the page was given them", async () => {
      const taskId = await startServer();
      const answered = answerHolds(taskId, ["dont_send"]);
      const done = await workOnce(taskId, [...submitSteps(), giveBack], { holdMs: ANSWER_MS });
      await answered;
      expect(done.status).not.toBe("done");
      const log = await ctx.call(API_ROUTES.taskSends, { params: { id: taskId } });
      expect(log.ok && log.body.values["{{email}}"]).toBe("jordan@example.com");
      expect((await fixtureState()).submissions).toEqual([]);
    });

    it("lets the run lapse when nobody is home, then sends the approved request once in the next run", async () => {
      const taskId = await startServer();
      const first = await firstLapse(taskId);
      expect(first).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect(first.blockedDetail).toContain(
        "any run of six or more characters in a row from an email, phone, street, date of birth or hidden value",
      );
      expect((await fixtureState()).submissions).toEqual([]);
      const waiting = rowsOf(taskId).filter((row) => row.status === "awaiting_next_run");
      expect(waiting).toHaveLength(1);

      expect((await approveNext(taskId)).ok).toBe(true);
      const done = await workOnce(taskId, [...submitSteps(), report]);

      expect(done.status).toBe("done");
      const { submissions } = await fixtureState();
      expect(submissions).toHaveLength(1);
      expect(rowsOf(taskId).find((row) => row.id === waiting[0]?.id)?.status).toBe("spent");
      const released = releasedOf(taskId);
      expect(released).toHaveLength(1);
      expect(released[0]?.spendsSendId).toBe(waiting[0]?.id);
    });

    it("sends nothing in a run that was declined, and the run goes on to report", async () => {
      const taskId = await startServer();
      const answered = answerHolds(taskId, ["dont_send"]);
      const done = await workOnce(taskId, [...submitSteps(), giveBack], { holdMs: ANSWER_MS });
      await answered;
      expect(done.status).toBe("queued");
      expect((await fixtureState()).submissions).toEqual([]);
      expect(rowsOf(taskId).find((row) => row.kind === "held")?.status).toBe("declined");
    });
  });

  describe("a send the page makes on its own", () => {
    it("holds a debounced autosave that fires after the guard window used to have closed", async () => {
      const taskId = await startServer("/gate-delayed");
      const done = await workOnce(taskId, [
        open("/gate-delayed"),
        typeEmail,
        wait(2),
        snap,
        giveBack,
      ]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      expect(held.map((row) => row.status)).toEqual(["awaiting_next_run"]);
      expect(held[0]?.request).toMatchObject({ path: "/gate-autosave", method: "POST" });
    });

    it("sends nothing when the person declines it, and nothing at 0, 1.5 and 10 seconds", async () => {
      const taskId = await startServer("/gate-delayed");
      const answered = answerHolds(taskId, ["dont_send"]);
      await workOnce(taskId, [open("/gate-delayed"), typeEmail, wait(3), giveBack], {
        holdMs: ANSWER_MS,
      });
      await answered;
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      expect((await fixtureState()).submissions).toEqual([]);
    });

    it("does not let a pagehide beacon or a late timer out after an immediate report", async () => {
      const taskId = await startServer("/gate-beacon");
      await workOnce(taskId, [open("/gate-beacon"), typeEmail, giveBack]);
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      const paths = (await fixtureState()).hits.map((hit) => hit.path);
      expect(paths).not.toContain("/gate-beacon-post");
      expect(paths).not.toContain("/gate-late-post");
    });

    it("holds a form.submit() fired during a wait, and the lapse is never a failure to retry", async () => {
      const taskId = await startServer("/gate-delayed-submit");
      const done = await workOnce(taskId, [open("/gate-delayed-submit"), typeEmail, wait(2), snap]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect(done.attempts).toBe(1);
      expect((await fixtureState()).submissions).toEqual([]);
    });
  });

  describe("what the page sends besides a form", () => {
    it("holds a GET fetch and an image, and logs the held ones with the email hidden", async () => {
      const taskId = await startServer("/gate-get");
      const done = await workOnce(taskId, [open("/gate-get"), typeEmail, wait(1), snap, giveBack]);
      expect(done.status).toBe("blocked");
      const state = await fixtureState();
      expect(state.hits.filter((hit) => hit.path === "/gate-collect")).toEqual([]);
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      expect(held.length).toBeGreaterThan(0);
      expect(JSON.stringify(held.map((row) => row.request))).not.toContain("jordan@example.com");
    });

    it("holds a value placed in a query key, a header name or a subdomain label", async () => {
      const taskId = await startServer("/gate-keys", true);
      const done = await workOnce(taskId, [open("/gate-keys"), typeEmail, wait(2), snap, giveBack]);
      expect(done.status).toBe("blocked");
      const state = await fixtureState();
      expect(state.hits.filter((hit) => hit.path === "/gate-collect")).toEqual([]);
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      const requests = held.map((row) => row.request).filter((request) => "query" in request);
      expect(requests.some((r) => r.query.some((entry) => entry.path.includes("{{")))).toBe(true);
      expect(requests.some((r) => r.headers.some((entry) => entry.path.includes("{{")))).toBe(true);
      expect(requests.some((r) => r.host.includes("{{"))).toBe(true);
      expect(requests.some((r) => r.path.includes("{{"))).toBe(true);
      const packed = Buffer.from("jordan@example.com").toString("hex");
      expect(JSON.stringify(held.map((row) => row.request))).not.toContain(packed);
      expect(JSON.stringify(held.map((row) => row.request))).not.toContain("jordan@example.com");
    });

    it("refuses a value sent to another site and never offers it for approval", async () => {
      const taskId = await startServer("/gate-cross", true);
      await workOnce(taskId, [open("/gate-cross"), typeEmail, wait(2), giveBack]);
      expect((await fixtureState()).hits.filter((hit) => hit.host === "other.test")).toEqual([]);
      const refused = rowsOf(taskId).filter((row) => row.kind === "refused");
      expect(refused.map((row) => row.reason)).toContain("third_party_value");
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      expect(held.every((row) => "party" in row.request && row.request.party === "target")).toBe(
        true,
      );
    });

    it("stops with the live connection copy and receives no frame", async () => {
      const taskId = await startServer("/gate-ws");
      const done = await workOnce(taskId, [open("/gate-ws"), typeEmail, wait(2), giveBack]);
      expect((await fixtureState()).wsFrames).toEqual([]);
      expect(done).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect(done.blockedDetail).toContain("live connection");
      expect(done.mayHaveSubmitted).toBe(false);
    });
  });

  describe("channels the page can use besides a form", () => {
    it("holds a post made by a blob worker, and sends it once when the person says send", async () => {
      const taskId = await startServer("/gate-worker");
      const answered = answerHolds(taskId, ["send"]);
      await workOnce(taskId, [open("/gate-worker"), typeEmail, wait(2), giveBack], {
        holdMs: ANSWER_MS,
      });
      await answered;
      const posts = (await fixtureState()).hits.filter((hit) => hit.path === "/gate-worker-post");
      expect(posts).toHaveLength(1);
      expect(releasedOf(taskId)).toHaveLength(1);
    });

    it("sends nothing through a nested worker, a shared worker or a service worker", async () => {
      const nested = await startServer("/gate-worker-nested");
      await workOnce(nested, [open("/gate-worker-nested"), typeEmail, wait(2), giveBack]);
      expect((await fixtureState()).hits.map((hit) => hit.path)).not.toContain("/gate-inner-post");
      await ctx.app.close();
      await ctx.close();
      await resetFixture();
      const shared = await startServer("/gate-shared");
      await workOnce(shared, [open("/gate-shared"), typeEmail, wait(2), giveBack]);
      const paths = (await fixtureState()).hits.map((hit) => hit.path);
      expect(paths).not.toContain("/gate-shared-post");
      expect(paths).not.toContain("/sw.js");
      expect(paths).not.toContain("/gate-pip-present");
    });

    it("sends nothing through a stylesheet, a font, a srcdoc frame, a refresh, a blank-target form, an event stream or a beacon, and refuses the beacon instead of holding it", async () => {
      const taskId = await startServer("/gate-probes");
      await workOnce(taskId, [open("/gate-probes"), typeEmail, wait(2), giveBack]);
      const probes = (await fixtureState()).hits.filter((hit) =>
        hit.path.startsWith("/gate-probe-"),
      );
      expect(probes).toEqual([]);
      const heldPaths = rowsOf(taskId)
        .filter((row) => row.kind === "held")
        .map((row) => ("path" in row.request ? row.request.path : ""));
      for (const probe of ["css", "font", "srcdoc", "refresh", "sse"]) {
        expect(heldPaths.some((path) => path.includes(`/gate-probe-${probe}`))).toBe(true);
      }
      expect(heldPaths.some((path) => path.includes("/gate-probe-beacon"))).toBe(false);
      expect(
        rowsOf(taskId).some(
          (row) =>
            row.kind === "refused" &&
            row.reason === "not_holdable" &&
            "path" in row.request &&
            row.request.path.includes("/gate-probe-beacon"),
        ),
      ).toBe(true);
      expect(JSON.stringify(rowsOf(taskId).map((row) => row.request))).not.toContain(
        "jordan@example.com",
      );
    });

    it("refuses a value however the page packs it, and holds the unpacked ones", async () => {
      const taskId = await startServer("/gate-encode");
      await workOnce(taskId, [open("/gate-encode"), typeEmail, wait(2), giveBack]);
      const paths = (await fixtureState()).hits.map((hit) => hit.path);
      expect(paths).not.toContain("/gate-gzip-post");
      expect(paths).not.toContain("/gate-pixel");
      const rows = rowsOf(taskId);
      expect(rows.filter((row) => row.kind === "refused").map((row) => row.reason)).toContain(
        "third_party_value",
      );
      expect(JSON.stringify(rows.map((row) => row.request))).not.toContain("jordan@example.com");
    });

    it("holds a form navigation and a location change that carry the email", async () => {
      const taskId = await startServer("/gate-nav");
      await workOnce(taskId, [
        open("/gate-nav"),
        typeEmail,
        (v) => ({ calls: [["click", { ref: v.ref("Go to results") }]] }),
      ]);
      expect((await fixtureState()).hits.map((hit) => hit.path)).not.toContain("/gate-collect");
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      expect(held).toHaveLength(1);
      expect(held[0]?.request).toMatchObject({
        method: "GET",
        path: "/gate-collect",
        isDocument: true,
      });
    });

    it("follows a redirect that sends the same body again as part of the one release", async () => {
      const taskId = await startServer("/gate-hop");
      const answered = answerHolds(taskId, ["send"]);
      const done = await workOnce(
        taskId,
        [open("/gate-hop"), typeEmail, snap, clickLabel("Submit request"), report],
        { holdMs: ANSWER_MS },
      );
      await answered;
      expect(done.status).toBe("done");
      const { submissions } = await fixtureState();
      expect(submissions.map((submission) => submission.path)).toEqual(["/gate-optout"]);
      expect(rowsOf(taskId).filter((row) => row.kind === "held")).toHaveLength(1);
    });
  });

  describe("a window the page opens", () => {
    it("receives nothing the page posts through its handle", async () => {
      const taskId = await startServer("/gate-popup");
      await workOnce(taskId, [open("/gate-popup"), typeEmail, wait(2), giveBack]);
      const paths = (await fixtureState()).hits.map((hit) => hit.path);
      expect(paths).not.toContain("/gate-popup-post");
      expect(paths).not.toContain("/gate-popup-beacon");
      expect(paths).not.toContain("/gate-popup-blank");
    });
  });

  describe("channels nobody had probed", () => {
    it.each([
      ["an event source", "/gate-sse"],
      ["a meta refresh", "/gate-refresh"],
      ["a form aimed at a new tab", "/gate-blank-form"],
      ["a post that is answered with a 303", "/gate-see-other"],
      ["a state change of the address bar", "/gate-push-state"],
    ])("lets %s carry nothing of the email to the site", async (_, path) => {
      const taskId = await startServer(path);
      await workOnce(taskId, [open(path), typeEmail, wait(2), giveBack]);
      const { hits, submissions } = await fixtureState();
      const leaked = hits.filter((hit) =>
        `${hit.path} ${hit.search} ${hit.body}`.toLowerCase().includes("jordan"),
      );
      expect(leaked).toEqual([]);
      expect(submissions).toEqual([]);
    });
  });

  describe("the browser's own preloading, which makes requests outside the request gate", () => {
    it("runs in a Chrome whose preloading setting is off", async () => {
      const own = browser.contexts()[0];
      const page = own?.pages()[0] ?? (await own?.newPage());
      await page?.goto("chrome://prefs-internals");
      const text = String(await page?.evaluate("document.body.innerText"));
      const prefs = JSON.parse(text.slice(text.indexOf("{")));
      expect(prefs.net.network_prediction_options.value).toBe(2);
    });

    it.each([
      ["list rules that prefetch the address with the email at once", "/gate-spec-prefetch"],
      ["list rules that prerender the address with the email at once", "/gate-spec-prerender"],
    ])("sends nothing for %s", async (_, path) => {
      const taskId = await startServer(path);
      await workOnce(taskId, [open(path), typeEmail, wait(2), giveBack]);
      const { hits, submissions } = await fixtureState();
      expect(hits.filter((hit) => hit.path === "/gate-landing")).toEqual([]);
      expect(submissions).toEqual([]);
    });

    it.each([
      ["document rules like a WordPress site ships", "/gate-spec-document"],
      ["a Speculation-Rules header", "/gate-spec-header"],
    ])("sends nothing for %s and holds the click on a link with the email", async (_, path) => {
      const taskId = await startServer(path);
      await workOnce(taskId, [
        open(path),
        typeEmail,
        wait(2),
        snap,
        clickLabel("Continue"),
        wait(1),
        giveBack,
      ]);
      const { hits, submissions } = await fixtureState();
      expect(hits.filter((hit) => hit.path === "/gate-landing")).toEqual([]);
      expect(submissions).toEqual([]);
      expect(rowsOf(taskId).filter((row) => row.kind === "held")).toHaveLength(1);
    });
  });

  describe("what the browser attaches after the gate has read a request", () => {
    it("cuts the Referer of a later load to the site address after the page wrote the email into its own address", async () => {
      const taskId = await startServer("/gate-referer");
      await workOnce(taskId, [open("/gate-referer"), typeEmail, wait(2), giveBack]);
      const { hits } = await fixtureState();
      const pixel = hits.filter((hit) => hit.path === "/gate-pixel");
      expect(pixel).toHaveLength(1);
      expect(pixel[0]?.referer).toBe(`${ORIGIN}/`);
      expect(
        hits
          .map((hit) => hit.referer)
          .join(" ")
          .toLowerCase(),
      ).not.toContain("jordan");
      const noted = rowsOf(taskId).filter(
        (row) => row.kind === "guard_event" && row.reason === "referer_cut",
      );
      expect(noted.length).toBeGreaterThan(0);
    });

    it("refuses an approved send when the page set a cookie while it was held", async () => {
      const taskId = await startServer("/gate-cookie-hold");
      const answered = (async () => {
        await vi.waitUntil(
          () => rowsOf(taskId).some((row) => row.kind === "held" && row.status === "pending_live"),
          { timeout: 60_000, interval: 25 },
        );
        await vi.waitUntil(
          async () => (await runContext?.cookies())?.some((cookie) => cookie.name === "late"),
          { timeout: 30_000, interval: 25 },
        );
        const held = rowsOf(taskId).find((row) => row.kind === "held");
        expect((await decideRow(taskId, held?.id ?? "", "send")).status).toBe(200);
      })();
      await workOnce(
        taskId,
        [
          open("/gate-cookie-hold"),
          typeEmail,
          snap,
          clickLabel("Submit request"),
          wait(1),
          giveBack,
        ],
        { holdMs: ANSWER_MS },
      );
      await answered;
      const { hits, submissions } = await fixtureState();
      expect(submissions).toEqual([]);
      expect(hits.filter((hit) => hit.cookie.includes("late"))).toEqual([]);
      expect(
        rowsOf(taskId).some((row) => row.kind === "refused" && row.reason === "cookies_changed"),
      ).toBe(true);
      expect(releasedOf(taskId).every((row) => row.status !== "sent")).toBe(true);
    });
  });

  describe("a radio group with long values", () => {
    const chooseScope =
      (label: string): Step =>
      (v) => ({
        calls: [["check", { ref: v.ref(label), checked: true }]],
      });
    const submit = (label: string): Step[] => [
      open("/gate-scope"),
      typeEmail,
      chooseScope(label),
      snap,
      clickLabel("Submit request"),
    ];

    it("is not approved for another option of the group in the next run", async () => {
      const taskId = await startServer("/gate-scope");
      await workOnce(taskId, submit("Suppress marketing only"));
      const held = rowsOf(taskId).filter((row) => row.kind === "held");
      expect(JSON.stringify(held.map((row) => row.request))).not.toContain("served_token");
      expect((await approveNext(taskId)).ok).toBe(true);
      const after = await workOnce(taskId, [...submit("Share with partner brands"), giveBack]);
      expect(after).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      expect((await fixtureState()).submissions).toEqual([]);
    });

    it("is sent when the next run picks the option the person saw", async () => {
      const taskId = await startServer("/gate-scope");
      await workOnce(taskId, submit("Suppress marketing only"));
      expect((await approveNext(taskId)).ok).toBe(true);
      const done = await workOnce(taskId, [...submit("Suppress marketing only"), report]);
      expect(done.status).toBe("done");
      const { submissions } = await fixtureState();
      expect(submissions).toHaveLength(1);
      expect(submissions[0]?.fields.scope).toBe("suppress_marketing_only_please");
    });
  });

  describe("the same-label second form", () => {
    it("is not approved by the approval of the first form", async () => {
      const taskId = await startServer();
      await firstLapse(taskId);
      expect((await approveNext(taskId)).ok).toBe(true);
      const after = await workOnce(taskId, [
        ...submitSteps().slice(0, -1),
        clickLabel("Submit request", 1),
        giveBack,
      ]);
      expect(after).toMatchObject({ status: "blocked", blockedReason: "approval_needed" });
      const { submissions } = await fixtureState();
      expect(submissions.filter((submission) => submission.path === "/gate-newsletter")).toEqual(
        [],
      );
      expect(submissions).toEqual([]);
    });
  });
});
