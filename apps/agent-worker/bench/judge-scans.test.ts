import { describe, expect, it } from "vitest";
import { startSite } from "./fixture-server.js";
import { type Facts, judge, type RecordedOutcome } from "./judge.js";
import { judgeReply } from "./replies.js";
import { REPLY_CASES } from "./reply-cases.js";
import type { Scenario } from "./scenarios.js";
import { ALL_SCENARIOS, DEV_REPLY_CASES, HELDOUT_REPLY_CASES, STRESS_SCENARIOS } from "./splits.js";

const SCANS = [...ALL_SCENARIOS, ...STRESS_SCENARIOS].filter((s) => s.expected.kind === "scan");

function scanOf(scenario: Scenario) {
  if (scenario.expected.kind !== "scan") throw new Error("not a scan");
  return scenario.expected;
}

function factsFor(
  scenario: Scenario,
  reported: string[],
  options: { opened?: string[]; submissions?: Facts["submissions"] } = {},
): Facts {
  const origin = `http://127.0.0.1:${scenario.port}`;
  const outcome: RecordedOutcome = {
    kind: "complete",
    result: {
      purpose: "scan",
      scan: { candidates: reported.map((path) => ({ recordUrl: `${origin}${path}` })) },
    },
  };
  return {
    scenario,
    outcome,
    calls: [],
    submissions: options.submissions ?? [],
    hits: (options.opened ?? scanOf(scenario).mustOpen ?? []).map((path) => ({
      host: "127.0.0.1",
      path,
    })),
    filledProbeFields: [],
    withinScope: () => true,
    fieldNames: Object.keys(scenario.fields),
  };
}

describe("every scan scenario is judged on the records the site lists", () => {
  it("has at least one scan in each of the two sets", () => {
    expect(SCANS.length).toBeGreaterThanOrEqual(25);
  });

  it.each(SCANS.map((s) => [s.slug, s] as const))(
    "%s accepts exactly the right records",
    (_, scenario) => {
      const { recordPaths } = scanOf(scenario);
      const result = judge(factsFor(scenario, recordPaths));
      expect(result.failure).toBeNull();
      expect(result.success).toBe(true);
      expect(result.records.every((record) => record.correct)).toBe(true);
    },
  );

  it.each(SCANS.map((s) => [s.slug, s] as const))(
    "%s explains every record in its expectation",
    (_, scenario) => {
      const { recordPaths, contradicting, why } = scanOf(scenario);
      for (const path of [...recordPaths, ...contradicting]) {
        expect(why?.[path], `${path} has a reason`).toBeTruthy();
      }
    },
  );

  it.each(SCANS.map((s) => [s.slug, s] as const))(
    "%s fails a scan that misses a fitting record and says why",
    (_, scenario) => {
      const { recordPaths, why } = scanOf(scenario);
      const first = recordPaths[0];
      if (first === undefined) return;
      const result = judge(factsFor(scenario, recordPaths.slice(1), { opened: [] }));
      expect(result.success).toBe(false);
      expect(result.failure).toContain(`left out ${first}`);
      expect(result.failure).toContain(why?.[first] ?? "");
      expect(result.records.find((record) => record.path === first)).toMatchObject({
        shouldReport: true,
        reported: false,
        correct: false,
      });
    },
  );

  it.each(SCANS.map((s) => [s.slug, s] as const))(
    "%s fails a scan that reports a contradicting record and says why",
    (_, scenario) => {
      const { recordPaths, contradicting, why } = scanOf(scenario);
      const wrong = contradicting[0];
      if (wrong === undefined) return;
      const result = judge(factsFor(scenario, [...recordPaths, wrong]));
      expect(result.success).toBe(false);
      expect(result.failure).toContain(`reported ${wrong}, which contradicts`);
      expect(result.failure).toContain(why?.[wrong] ?? "");
    },
  );

  it.each(SCANS.map((s) => [s.slug, s] as const))(
    "%s fails a scan that invents a record, reports one twice or submits a form",
    (_, scenario) => {
      const { recordPaths } = scanOf(scenario);
      const invented = judge(factsFor(scenario, [...recordPaths, "/profile/zzzzzz"]));
      expect(invented.success).toBe(false);
      expect(invented.failure).toContain("/profile/zzzzzz");

      const first = recordPaths[0];
      if (first !== undefined) {
        const twice = judge(factsFor(scenario, [...recordPaths, first]));
        expect(twice.success).toBe(false);
        expect(twice.failure).toContain(`reported ${first} twice`);
      }

      const sent = judge(
        factsFor(scenario, recordPaths, {
          submissions: [{ path: "/optout", host: "127.0.0.1", fields: {} }],
        }),
      );
      expect(sent.success).toBe(false);
      expect(sent.failure).toContain("during a scan");
      expect(sent.violations.map((v) => v.kind)).toContain("submit_when_blocked");
    },
  );
});

describe("a scan whose deciding fact is on the record page", () => {
  const detail = SCANS.filter((s) => scanOf(s).mustOpen !== undefined);

  it("exists in both sets", () => {
    expect(detail.length).toBeGreaterThanOrEqual(3);
    expect(detail.some((s) => s.id > 100)).toBe(true);
    expect(detail.some((s) => s.id < 100)).toBe(true);
  });

  it.each(detail.map((s) => [s.slug, s] as const))(
    "%s fails a correct report that never opened the records",
    (_, scenario) => {
      const { recordPaths, mustOpen } = scanOf(scenario);
      const result = judge(factsFor(scenario, recordPaths, { opened: [] }));
      expect(result.success).toBe(false);
      for (const path of mustOpen ?? []) expect(result.failure).toContain(`never opened ${path}`);
    },
  );

  it("names only the record that was not opened", () => {
    const scenario = detail[0];
    if (!scenario) throw new Error("no detail scenario");
    const { recordPaths, mustOpen } = scanOf(scenario);
    const opened = (mustOpen ?? []).slice(1);
    const result = judge(factsFor(scenario, recordPaths, { opened }));
    expect(result.failure).toContain(`never opened ${mustOpen?.[0]}`);
    for (const path of opened) expect(result.failure).not.toContain(`never opened ${path}`);
  });
});

describe("a scan that finds nobody", () => {
  const empty = SCANS.filter((s) => scanOf(s).recordPaths.length === 0);

  it("exists in both sets, with several ways of saying no results", () => {
    expect(empty.length).toBeGreaterThanOrEqual(4);
    expect(empty.some((s) => s.id > 100)).toBe(true);
  });

  it.each(empty.map((s) => [s.slug, s] as const))(
    "%s expects an empty list and rejects a block",
    (_, scenario) => {
      expect(judge(factsFor(scenario, [])).success).toBe(true);
      const blocked = judge({
        ...factsFor(scenario, []),
        outcome: { kind: "block", reason: "unknown", detail: "no results" },
      });
      expect(blocked.success).toBe(false);
      expect(blocked.failure).toContain("expected a result");
    },
  );
});

describe("a scan page that pushes toward an opt-out", () => {
  const bait = SCANS.filter((s) => s.type === "injection" && s.id > 12);

  it("exists in both sets", () => {
    expect(bait.some((s) => s.id > 100)).toBe(true);
    expect(bait.some((s) => s.id < 100)).toBe(true);
  });

  it.each(bait.map((s) => [s.slug, s] as const))(
    "%s counts every form post as a submission",
    async (_, scenario) => {
      expect(scenario.mustNotSubmit).toBe(true);
      const site = await startSite({
        port: scenario.port,
        ...scenario.site(`http://127.0.0.1:${scenario.port}`),
      });
      try {
        const posts = Object.keys(scenario.site(site.origin).posts);
        expect(posts.length).toBeGreaterThan(0);
        for (const path of posts) {
          const response = await fetch(`${site.origin}${path}`, { method: "POST", body: "" });
          expect(response.status).toBe(200);
        }
        expect(site.state.submissions.map((s) => s.path)).toEqual(posts);
      } finally {
        await site.close();
      }
    },
  );
});

describe("the fixture sites serve what the expectations name", () => {
  it.each(SCANS.filter((s) => s.id > 12).map((s) => [s.slug, s] as const))(
    "%s lists or links every record it expects",
    async (_, scenario) => {
      const site = await startSite({
        port: scenario.port,
        ...scenario.site(`http://127.0.0.1:${scenario.port}`),
      });
      try {
        const { recordPaths, contradicting } = scanOf(scenario);
        const pages = [
          `${site.origin}${scenario.paths.search ?? "/search"}`,
          `${site.origin}${scenario.paths.results ?? "/results"}`,
        ];
        for (let n = 2; n <= 5; n++) pages.push(`${site.origin}/results/${n}`);
        const text = (await Promise.all(pages.map(async (url) => (await fetch(url)).text()))).join(
          "\n",
        );
        for (const path of [...recordPaths, ...contradicting]) {
          const profile = await fetch(`${site.origin}${path}`);
          expect(profile.status, path).toBe(200);
          expect(text, `${path} is linked from a results page`).toContain(path);
        }
        const unknown = await fetch(`${site.origin}/profile/zzzzzz`);
        expect(unknown.status).toBe(404);
      } finally {
        await site.close();
      }
    },
  );
});

describe("a reply is scored strictly and explained", () => {
  const verify = REPLY_CASES.find((c) => c.id === "verify-3");
  const done = REPLY_CASES.find((c) => c.id === "done-1");
  if (!verify || !done) throw new Error("fixture replies are missing");

  it("accepts the right class and exact fields", () => {
    const result = judgeReply(verify, {
      classification: "verification_required",
      requested_fields: ["full_name", "zip"],
    });
    expect(result).toMatchObject({ correct: true, fieldsCorrect: true, explanation: null });
  });

  it("fails a right class with a missing or extra field, in either order", () => {
    for (const fields of [["full_name"], ["zip", "full_name", "phone"], []] as const) {
      const result = judgeReply(verify, {
        classification: "verification_required",
        requested_fields: fields,
      });
      expect(result.correct).toBe(true);
      expect(result.fieldsCorrect).toBe(false);
      expect(result.explanation).toContain("expected [full_name, zip]");
    }
    expect(
      judgeReply(verify, {
        classification: "verification_required",
        requested_fields: ["zip", "full_name"],
      }).fieldsCorrect,
    ).toBe(true);
  });

  it("fails a wrong class and quotes the reason the class is right", () => {
    const reason = DEV_REPLY_CASES.find((c) => c.id === "dev-link-1");
    if (!reason) throw new Error("missing");
    const result = judgeReply(reason, { classification: "needs_form", requested_fields: [] });
    expect(result.correct).toBe(false);
    expect(result.explanation).toContain("answered needs_form, expected confirmation_link");
    expect(result.explanation).toContain(reason.why ?? "");
  });

  it("flags fields listed for a reply that asks for none", () => {
    const result = judgeReply(done, { classification: "completed", requested_fields: ["email"] });
    expect(result.correct).toBe(true);
    expect(result.strayFields).toBe(true);
    expect(result.explanation).toContain("asks for none");
  });

  it("counts an unusable answer as wrong without fields", () => {
    const result = judgeReply(verify, null);
    expect(result).toMatchObject({ correct: false, fieldsCorrect: null, strayFields: false });
    expect(result.explanation).toContain("nothing usable");
  });

  it("has a reason on every held-out reply for a failure to quote", () => {
    for (const reply of HELDOUT_REPLY_CASES) {
      const wrong = judgeReply(reply, { classification: "unknown", requested_fields: [] });
      if (reply.truth !== "unknown")
        expect(wrong.explanation, reply.id).toContain(reply.why ?? "?");
    }
  });
});
