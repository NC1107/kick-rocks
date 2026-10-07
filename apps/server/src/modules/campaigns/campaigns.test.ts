import { campaigns, requests as requestsTable, scans, targets, tasks } from "@kickrocks/db";
import {
  API_ROUTES,
  type CampaignBody,
  type RecipeInput,
  type RequestStatus,
} from "@kickrocks/shared";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AppError } from "../../core/errors.js";
import { FAKE_STATUTE } from "../../test-utils/fake-legal.js";
import {
  createTestContext,
  seedMailbox,
  seedProfile,
  seedRecipe,
  seedRequest,
  seedScan,
  seedTarget,
  seedTask,
  type TestContext,
} from "../../test-utils/index.js";

let ctx: TestContext;

beforeEach(async () => {
  ctx = await createTestContext();
});

afterEach(async () => {
  await ctx.close();
});

/** A remove recipe that never types the mailbox address into the form. */
const NO_EMAIL_RECIPE: Partial<RecipeInput> = {
  fields: ["record_url"],
  steps: [
    { kind: "goto", url: "https://fixture.test/optout" },
    { kind: "fill", target: { label: "Profile URL" }, field: "record_url" },
    { kind: "click", target: { role: "button", label: "Remove" } },
    { kind: "expect_text", text: "request received" },
  ],
};

const BOTH = ["opt_out", "delete"] as const;
const body = (targetIds: string[], rights: CampaignBody["rights"] = [...BOTH]): CampaignBody => ({
  selection: { targetIds },
  rights,
});

const preview = (profileId: string, payload: CampaignBody) =>
  ctx.call(API_ROUTES.campaignsPreview, { params: { id: profileId }, body: payload });
const create = (profileId: string, payload: CampaignBody) =>
  ctx.call(API_ROUTES.campaignsCreate, { params: { id: profileId }, body: payload });

async function previewOk(profileId: string, payload: CampaignBody) {
  const result = await preview(profileId, payload);
  if (!result.ok) throw new Error(`preview failed: ${JSON.stringify(result.body)}`);
  return result.body;
}

async function createOk(profileId: string, payload: CampaignBody) {
  const result = await create(profileId, payload);
  if (!result.ok) throw new Error(`create failed: ${JSON.stringify(result.body)}`);
  return result.body;
}

function setup(state: "TX" | "CA" = "TX") {
  const profile = seedProfile(ctx, { state });
  const mailbox = seedMailbox(ctx, profile.id);
  return { profile, mailbox };
}

const reasonOf = (items: { targetId: string; reason: string | null }[], id: string) =>
  items.find((item) => item.targetId === id)?.reason;

describe("preview", () => {
  it("shows what would happen without writing anything", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "mail-broker" });

    const result = await previewOk(profile.id, body(["mail-broker"]));

    expect(result.counts).toEqual({ request_created: 1, scan_started: 0, skipped: 0 });
    expect(result.items).toEqual([
      {
        targetId: "mail-broker",
        targetName: "Example Broker mail-broker",
        outcome: "request_created",
        requestId: null,
        scanId: null,
        reason: null,
        detail: null,
      },
    ]);
    const db = ctx.services.db;
    expect(db.select().from(requestsTable).all()).toEqual([]);
    expect(db.select().from(campaigns).all()).toEqual([]);
    expect(db.select().from(tasks).all()).toEqual([]);
    expect(ctx.mail.sent).toEqual([]);
  });

  it("composes the sample email with the composer, so it is the mail that goes out", async () => {
    const { profile } = setup("CA");
    seedTarget(ctx, { id: "mail-broker" });

    const { sampleEmail } = await previewOk(profile.id, body(["mail-broker"]));
    const created = await createOk(profile.id, body(["mail-broker"]));

    const request = ctx.services.requests.getOrThrow(created.items[0]?.requestId as string);
    const sent = ctx.services.composer.requestEmail(request, "initial").email;
    expect(sampleEmail).not.toBeNull();
    expect(sampleEmail?.subject).toContain("KR-XXXXXX");
    expect(sampleEmail?.subject.replace("KR-XXXXXX", request.reference)).toBe(sent.subject);
    expect(sampleEmail?.text.replace("KR-XXXXXX", request.reference)).toBe(sent.text);
    expect(sent.text).toContain(FAKE_STATUTE.id);
  });

  it("takes the sample from the first email request and leaves it out when none would go", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "form-only", contactMethod: "form", privacyEmail: null });
    seedTarget(ctx, { id: "second", name: "Second Mail" });

    const withEmail = await previewOk(profile.id, body(["form-only", "second"]));
    expect(withEmail.sampleEmail?.text).toContain("To: Second Mail");

    const none = await previewOk(profile.id, body(["form-only"]));
    expect(none.sampleEmail).toBeNull();
  });

  it("answers an empty preview for a preset that matches nothing", async () => {
    const { profile } = setup();
    const result = await previewOk(profile.id, {
      selection: { preset: "companies" },
      rights: ["opt_out"],
    });
    expect(result).toEqual({
      items: [],
      counts: { request_created: 0, scan_started: 0, skipped: 0 },
      sampleEmail: null,
    });
  });
});

describe("presets", () => {
  function seedMix() {
    seedTarget(ctx, { id: "market", name: "Market", category: "marketing", priority: "normal" });
    seedTarget(ctx, { id: "regd", name: "Regd", category: "registered-broker", priority: "high" });
    seedTarget(ctx, {
      id: "form-broker",
      name: "Form Broker",
      contactMethod: "form",
      privacyEmail: null,
    });
    seedTarget(ctx, {
      id: "people",
      name: "People",
      category: "people-search",
      priority: "crucial",
      contactMethod: "both",
    });
    seedTarget(ctx, { kind: "company", id: "shop", name: "Shop", category: "retail" });
  }

  const ids = (items: { targetId: string }[]) => items.map((item) => item.targetId);

  it("companies selects every company", async () => {
    const { profile } = setup();
    seedMix();
    const result = await previewOk(profile.id, {
      selection: { preset: "companies" },
      rights: ["opt_out"],
    });
    expect(ids(result.items)).toEqual(["shop"]);
  });

  it("email_brokers selects brokers with an email address that are not people-search sites", async () => {
    const { profile } = setup();
    seedMix();
    const result = await previewOk(profile.id, {
      selection: { preset: "email_brokers" },
      rights: ["opt_out"],
    });
    expect(ids(result.items)).toEqual(["regd", "market"]);
  });

  it("people_search selects every site that needs a record, background checks included", async () => {
    const { profile } = setup();
    seedMix();
    seedTarget(ctx, { id: "bgcheck", name: "Bg Check", category: "background-check" });
    const result = await previewOk(profile.id, {
      selection: { preset: "people_search" },
      rights: ["opt_out"],
    });
    expect(ids(result.items)).toEqual(["people", "bgcheck"]);
    expect(result.counts.scan_started).toBe(2);
  });

  it("everything selects all targets, most important first", async () => {
    const { profile } = setup();
    seedMix();
    const result = await previewOk(profile.id, {
      selection: { preset: "everything" },
      rights: ["opt_out"],
    });
    expect(ids(result.items)).toEqual(["people", "regd", "form-broker", "market", "shop"]);
  });

  it("never selects a target the dataset retired", async () => {
    const { profile } = setup();
    seedMix();
    seedTarget(ctx, { id: "old", name: "Old" });
    ctx.services.db.update(targets).set({ retired: true }).where(eq(targets.id, "old")).run();
    const result = await previewOk(profile.id, {
      selection: { preset: "everything" },
      rights: ["opt_out"],
    });
    expect(ids(result.items)).not.toContain("old");
  });
});

describe("create", () => {
  it("opens an email request per target, queued with an email task, under one campaign", async () => {
    const { profile, mailbox } = setup();
    seedTarget(ctx, { id: "one" });
    seedTarget(ctx, { id: "two" });

    const created = await createOk(profile.id, body(["one", "two"], ["opt_out"]));

    expect(created.counts).toEqual({ request_created: 2, scan_started: 0, skipped: 0 });
    const rows = ctx.services.db.select().from(requestsTable).all();
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row).toMatchObject({
        status: "queued",
        channel: "email",
        rights: ["opt_out"],
        campaignId: created.campaignId,
        mailboxId: mailbox.id,
        profileId: profile.id,
      });
    }
    expect(created.items.map((item) => item.requestId).sort()).toEqual(
      rows.map((r) => r.id).sort(),
    );
    const taskRows = ctx.services.db.select().from(tasks).all();
    expect(taskRows.map((task) => task.kind)).toEqual(["email_send", "email_send"]);
    expect(ctx.mail.sent).toEqual([]);
  });

  it("stores the campaign with its selection, counts, and what it skipped", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "ok" });
    seedTarget(ctx, { id: "dead", contactMethod: "unknown", privacyEmail: null, optOutUrl: null });

    const created = await createOk(profile.id, body(["ok", "dead"]));

    const [row] = ctx.services.db.select().from(campaigns).all();
    expect(row).toMatchObject({
      id: created.campaignId,
      profileId: profile.id,
      rights: ["opt_out", "delete"],
      selection: { targetIds: ["ok", "dead"] },
      createdCount: 1,
    });
    expect(row?.skipped).toHaveLength(1);
    expect(row?.skipped[0]).toMatchObject({ targetId: "dead", reason: "no_contact_method" });
  });

  it("prefers email when a target takes both, and uses the form when it only has one", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "both", contactMethod: "both" });
    seedTarget(ctx, {
      id: "form",
      contactMethod: "form",
      privacyEmail: null,
      requirements: [],
    });

    await createOk(profile.id, body(["both", "form"]));

    const channels = Object.fromEntries(
      ctx.services.db
        .select()
        .from(requestsTable)
        .all()
        .map((row) => [row.targetId, row.channel]),
    );
    expect(channels).toEqual({ both: "email", form: "form" });
  });

  it("queues a form task with the recipe, or an agent task when there is none", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "with-recipe", privacyEmail: null, contactMethod: "form" });
    seedTarget(ctx, { id: "no-recipe", privacyEmail: null, contactMethod: "form" });
    seedRecipe(ctx, "with-recipe", { definition: NO_EMAIL_RECIPE });

    await createOk(profile.id, body(["with-recipe", "no-recipe"]));

    const kinds = Object.fromEntries(
      ctx.services.db
        .select()
        .from(tasks)
        .all()
        .map((task) => [task.targetId, task.kind]),
    );
    expect(kinds).toEqual({ "with-recipe": "form", "no-recipe": "agent" });
  });

  it("starts a scan for a target that needs a record, and says which scan", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "people", category: "people-search", contactMethod: "form" });

    const created = await createOk(profile.id, body(["people"]));

    expect(created.counts).toEqual({ request_created: 0, scan_started: 1, skipped: 0 });
    const [item] = created.items;
    expect(item).toMatchObject({ outcome: "scan_started", requestId: null, reason: null });
    const scanRows = ctx.services.db.select().from(scans).all();
    expect(scanRows.map((scan) => scan.id)).toEqual([item?.scanId]);
    expect(ctx.services.db.select().from(requestsTable).all()).toEqual([]);
    expect(ctx.services.db.select().from(tasks).all()).toMatchObject([
      { kind: "agent", targetId: "people" },
    ]);
  });

  it("scans without a mailbox, since a scan sends no email", async () => {
    const profile = seedProfile(ctx);
    seedTarget(ctx, { id: "people", category: "people-search", contactMethod: "form" });

    const created = await createOk(profile.id, body(["people"]));

    expect(created.counts.scan_started).toBe(1);
  });

  it("counts a target once however many times it was listed", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "one" });

    const created = await createOk(profile.id, body(["one", "one"]));

    expect(created.items).toHaveLength(1);
    expect(ctx.services.db.select().from(requestsTable).all()).toHaveLength(1);
  });

  it("running the same campaign twice does not send twice", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "one" });
    seedTarget(ctx, { id: "people", category: "people-search", contactMethod: "form" });

    await createOk(profile.id, body(["one", "people"]));
    const again = await createOk(profile.id, body(["one", "people"]));

    expect(reasonOf(again.items, "one")).toBe("already_active");
    expect(reasonOf(again.items, "people")).toBe("scan_in_progress");
    expect(again.counts).toEqual({ request_created: 0, scan_started: 0, skipped: 2 });
    expect(ctx.services.db.select().from(requestsTable).all()).toHaveLength(1);
  });

  it("rolls the whole campaign back when something unexpected fails midway", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "one", name: "One" });
    seedTarget(ctx, { id: "two", name: "Two" });
    const open = ctx.services.requests.open.bind(ctx.services.requests);
    let calls = 0;
    ctx.services.requests.open = (input) => {
      calls += 1;
      if (calls === 2) throw new Error("disk is on fire");
      return open(input);
    };

    const result = await create(profile.id, body(["one", "two"]));

    expect(result).toMatchObject({ ok: false, status: 500 });
    expect(ctx.services.db.select().from(requestsTable).all()).toEqual([]);
    expect(ctx.services.db.select().from(campaigns).all()).toEqual([]);
    expect(ctx.services.db.select().from(tasks).all()).toEqual([]);
  });

  it("turns a conflict the planner did not foresee into a skip and keeps the rest", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "one", name: "One" });
    seedTarget(ctx, { id: "two", name: "Two" });
    const open = ctx.services.requests.open.bind(ctx.services.requests);
    ctx.services.requests.open = (input) => {
      if (input.targetId === "one") {
        return ctx.services.db.transaction(() => {
          open(input);
          throw new AppError(409, "mailbox_required", "Connect a mailbox");
        });
      }
      return open(input);
    };

    const created = await createOk(profile.id, body(["one", "two"]));

    expect(reasonOf(created.items, "one")).toBe("no_mailbox");
    expect(created.counts).toEqual({ request_created: 1, scan_started: 0, skipped: 1 });
    expect(ctx.services.db.select().from(requestsTable).all()).toHaveLength(1);
  });
});

describe("skip reasons", () => {
  it("no_contact_method: neither an email address nor a form", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "dead", contactMethod: "unknown", privacyEmail: null, optOutUrl: null });

    const result = await previewOk(profile.id, body(["dead"]));

    expect(result.items[0]).toMatchObject({
      outcome: "skipped",
      reason: "no_contact_method",
      requestId: null,
      scanId: null,
    });
    expect(result.items[0]?.detail).toContain("Example Broker dead");
    expect(result.counts.skipped).toBe(1);
  });

  it.each([
    ["postal_mail", "a letter in the post"],
    ["fax", "a fax"],
    ["phone_call", "a phone call"],
    ["paid", "a payment"],
  ] as const)("unsupported_channel: a form behind %s and no email", async (requirement, label) => {
    const { profile } = setup();
    seedTarget(ctx, {
      id: "offline",
      privacyEmail: null,
      contactMethod: "form",
      requirements: [requirement],
    });

    const result = await previewOk(profile.id, body(["offline"]));

    expect(result.items[0]).toMatchObject({ outcome: "skipped", reason: "unsupported_channel" });
    expect(result.items[0]?.detail).toContain(label);
  });

  it("unsupported_channel: lists everything the target insists on", async () => {
    const { profile } = setup();
    seedTarget(ctx, {
      id: "offline",
      privacyEmail: null,
      optOutUrl: null,
      contactMethod: "unknown",
      requirements: ["postal_mail", "fax", "captcha"],
    });

    const result = await previewOk(profile.id, body(["offline"]));

    expect(result.items[0]?.reason).toBe("unsupported_channel");
    expect(result.items[0]?.detail).toContain("a letter in the post or a fax");
  });

  it("still emails a target whose form needs a phone call, since email works", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "mixed", contactMethod: "both", requirements: ["phone_call"] });

    const result = await previewOk(profile.id, body(["mixed"]));

    expect(result.items[0]?.outcome).toBe("request_created");
  });

  it("still sends a request to a target that asks for a captcha, an account, or an ID", async () => {
    const { profile } = setup();
    seedTarget(ctx, {
      id: "gated",
      privacyEmail: null,
      contactMethod: "form",
      requirements: ["captcha", "account", "id_upload"],
    });

    const result = await previewOk(profile.id, body(["gated"]));

    expect(result.items[0]?.outcome).toBe("request_created");
  });

  it("no_mailbox: an email request for a profile with no mailbox", async () => {
    const profile = seedProfile(ctx);
    seedTarget(ctx, { id: "mail" });

    const result = await previewOk(profile.id, body(["mail"]));
    expect(result.items[0]).toMatchObject({ outcome: "skipped", reason: "no_mailbox" });
    expect(result.sampleEmail).toBeNull();

    const created = await createOk(profile.id, body(["mail"]));
    expect(created.items[0]?.reason).toBe("no_mailbox");
    expect(created.counts.skipped).toBe(1);
    expect(ctx.services.db.select().from(requestsTable).all()).toEqual([]);
  });

  it("no_mailbox: a form that confirms by email needs the mailbox, one that does not does not", async () => {
    const profile = seedProfile(ctx);
    seedTarget(ctx, {
      id: "confirming",
      privacyEmail: null,
      contactMethod: "form",
      requirements: ["email_confirmation"],
    });
    seedTarget(ctx, { id: "typed-email", privacyEmail: null, contactMethod: "form" });
    seedRecipe(ctx, "typed-email", { definition: { fields: ["record_url", "email"] } });
    seedTarget(ctx, { id: "plain", privacyEmail: null, contactMethod: "form" });
    seedRecipe(ctx, "plain", { definition: NO_EMAIL_RECIPE });

    const result = await previewOk(profile.id, body(["confirming", "typed-email", "plain"]));
    const created = await createOk(profile.id, body(["confirming", "typed-email", "plain"]));

    expect(result.items.map((item) => item.reason)).toEqual(["no_mailbox", "no_mailbox", null]);
    expect(created.items.map((item) => item.outcome)).toEqual([
      "skipped",
      "skipped",
      "request_created",
    ]);
  });

  it("a broken recipe that would type the email does not count when choosing the mailbox rule", async () => {
    const profile = seedProfile(ctx);
    seedTarget(ctx, { id: "t", privacyEmail: null, contactMethod: "form" });
    seedRecipe(ctx, "t", { health: "broken", definition: { fields: ["record_url", "email"] } });

    const result = await previewOk(profile.id, body(["t"]));
    const created = await createOk(profile.id, body(["t"]));

    expect(result.items[0]?.outcome).toBe("request_created");
    expect(created.items[0]?.outcome).toBe("request_created");
  });

  it.each<[RequestStatus, boolean]>([
    ["draft", true],
    ["queued", true],
    ["sent", true],
    ["awaiting_reply", true],
    ["needs_verification", true],
    ["bounced", true],
    ["no_response", true],
    ["follow_up_due", true],
    ["rejected", false],
    ["cancelled", false],
    ["no_record", false],
  ])(
    "already_active: a %s request for the same profile and target blocks it: %s",
    async (status, blocks) => {
      const { profile } = setup();
      seedTarget(ctx, { id: "t" });
      seedRequest(ctx, { profileId: profile.id, targetId: "t", status });

      const result = await previewOk(profile.id, body(["t"]));

      expect(result.items[0]?.reason ?? null).toBe(blocks ? "already_active" : null);
    },
  );

  it("already_active ignores requests of other profiles", async () => {
    const { profile } = setup();
    const other = seedProfile(ctx, { displayName: "Sam Example" });
    seedTarget(ctx, { id: "t" });
    seedRequest(ctx, { profileId: other.id, targetId: "t", status: "awaiting_reply" });

    const result = await previewOk(profile.id, body(["t"]));

    expect(result.items[0]?.outcome).toBe("request_created");
  });

  it("already_confirmed: nothing is re-sent after a confirmed removal", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "t" });
    seedTarget(ctx, { id: "people", category: "people-search", contactMethod: "form" });
    seedRequest(ctx, { profileId: profile.id, targetId: "t", status: "confirmed" });
    seedRequest(ctx, {
      profileId: profile.id,
      targetId: "people",
      status: "confirmed",
      channel: "form",
    });

    const result = await previewOk(profile.id, body(["t", "people"]));

    expect(result.items.map((item) => item.reason)).toEqual([
      "already_confirmed",
      "already_confirmed",
    ]);
    expect(result.items[0]?.detail).toContain("re-scan");
  });

  it("already_active wins over an earlier confirmed request, which is how a relisting looks", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "t" });
    seedRequest(ctx, { profileId: profile.id, targetId: "t", status: "confirmed" });
    seedRequest(ctx, { profileId: profile.id, targetId: "t", status: "queued" });

    const result = await previewOk(profile.id, body(["t"]));

    expect(result.items[0]?.reason).toBe("already_active");
  });

  it("scan_in_progress: a live scan task, from a recipe or an agent, blocks a second", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "recipe-site", category: "people-search", contactMethod: "form" });
    seedTarget(ctx, { id: "agent-site", category: "people-search", contactMethod: "form" });
    seedTarget(ctx, { id: "quiet-site", category: "people-search", contactMethod: "form" });
    seedTask(ctx, {
      kind: "scan",
      payload: { profileId: profile.id, targetId: "recipe-site", recipeId: null, variant: null },
      profileId: profile.id,
      targetId: "recipe-site",
    });
    seedTask(ctx, {
      kind: "agent",
      status: "blocked",
      blockedReason: "captcha",
      payload: {
        purpose: "scan",
        profileId: profile.id,
        targetId: "agent-site",
        requestId: null,
        recordUrl: null,
        variant: null,
        reason: "no_recipe",
        previousError: null,
        blockedReason: null,
      },
      profileId: profile.id,
      targetId: "agent-site",
    });
    seedScan(ctx, {
      profileId: profile.id,
      targetId: "quiet-site",
      finishedAt: ctx.clock.now().toISOString(),
    });

    const result = await previewOk(profile.id, body(["recipe-site", "agent-site", "quiet-site"]));

    expect(result.items.map((item) => item.reason)).toEqual([
      "scan_in_progress",
      "scan_in_progress",
      null,
    ]);
  });

  it("scan_in_progress ignores a removal agent task for the same target", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "site", category: "people-search", contactMethod: "form" });
    seedTask(ctx, {
      kind: "agent",
      payload: {
        purpose: "remove",
        profileId: profile.id,
        targetId: "site",
        requestId: null,
        recordUrl: null,
        variant: null,
        reason: "no_recipe",
        previousError: null,
        blockedReason: null,
      },
      profileId: profile.id,
      targetId: "site",
    });

    const result = await previewOk(profile.id, body(["site"]));

    expect(result.items[0]?.outcome).toBe("scan_started");
  });

  const CA_REGISTRY = [{ source: "ca-registry-2025" as const, license: "public-record" as const }];

  describe("covered_by_platform", () => {
    function withPlatform() {
      const resolve = ctx.legal.resolveLegalBasis.bind(ctx.legal);
      ctx.legal.resolveLegalBasis = (input) => {
        const basis = resolve(input);
        return basis.statute
          ? {
              ...basis,
              statute: {
                ...basis.statute,
                platform: {
                  name: "DROP",
                  url: "https://example.org/drop",
                  note: "Sign up once for all registered brokers.",
                },
              },
            }
          : basis;
      };
    }

    it("skips a broker registered with California when a statute with a platform applies", async () => {
      const { profile } = setup("CA");
      withPlatform();
      seedTarget(ctx, { id: "regd", category: "registered-broker", sources: CA_REGISTRY });
      seedTarget(ctx, {
        id: "listed",
        category: "marketing",
        sources: [{ source: "ca-registry-2025", license: "public-record" }],
      });

      const result = await previewOk(profile.id, body(["regd", "listed"]));
      const created = await createOk(profile.id, body(["regd", "listed"]));

      for (const items of [result.items, created.items]) {
        expect(items.map((item) => item.reason)).toEqual([
          "covered_by_platform",
          "covered_by_platform",
        ]);
        expect(items[0]?.detail).toContain("DROP");
        expect(items[0]?.detail).toContain("Sign up once");
      }
      expect(ctx.services.db.select().from(requestsTable).all()).toEqual([]);
    });

    it("does not skip a broker that is not registered, a company, or a profile outside California", async () => {
      const ca = setup("CA").profile;
      withPlatform();
      seedTarget(ctx, { id: "plain", category: "marketing" });
      seedTarget(ctx, { id: "shop", kind: "company", category: "retail" });
      seedTarget(ctx, { id: "regd", category: "registered-broker", sources: CA_REGISTRY });

      const inCalifornia = await previewOk(ca.id, body(["plain", "shop"]));
      expect(inCalifornia.counts.request_created).toBe(2);

      const texan = seedProfile(ctx, { state: "TX" });
      seedMailbox(ctx, texan.id);
      const elsewhere = await previewOk(texan.id, body(["regd"]));
      expect(elsewhere.items[0]?.outcome).toBe("request_created");
    });

    it("lets a request through when the rights chosen leave the platform's statute out", async () => {
      const { profile } = setup("CA");
      const resolve = ctx.legal.resolveLegalBasis.bind(ctx.legal);
      ctx.legal.resolveLegalBasis = (input) => {
        const basis = resolve({ ...input, rights: ["delete", "opt_out"] });
        return input.rights.includes("delete") && basis.statute
          ? {
              ...basis,
              statute: {
                ...basis.statute,
                platform: { name: "DROP", url: "https://example.org/drop", note: "" },
              },
            }
          : { ...basis, kind: "policy", id: "policy", statute: null };
      };
      seedTarget(ctx, { id: "regd", category: "registered-broker", sources: CA_REGISTRY });

      const optOutOnly = await previewOk(profile.id, body(["regd"], ["opt_out"]));
      const deleting = await previewOk(profile.id, body(["regd"], ["delete"]));

      expect(optOutOnly.items[0]?.outcome).toBe("request_created");
      expect(deleting.items[0]?.reason).toBe("covered_by_platform");
    });
  });

  it("reports skip reasons in the same order the targets were chosen, mixed with what goes out", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "a" });
    seedTarget(ctx, { id: "b", contactMethod: "unknown", privacyEmail: null, optOutUrl: null });
    seedTarget(ctx, { id: "c", category: "people-search", contactMethod: "form" });

    const result = await previewOk(profile.id, body(["c", "b", "a"]));

    expect(result.items.map((item) => [item.targetId, item.outcome])).toEqual([
      ["c", "scan_started"],
      ["b", "skipped"],
      ["a", "request_created"],
    ]);
    expect(result.counts).toEqual({ request_created: 1, scan_started: 1, skipped: 1 });
  });
});

describe("validation and errors", () => {
  it("answers 404 for a profile that does not exist", async () => {
    seedTarget(ctx, { id: "t" });
    for (const call of [preview, create]) {
      const result = await call("missing", body(["t"]));
      expect(result).toMatchObject({
        ok: false,
        status: 404,
        body: { error: "profile_not_found" },
      });
    }
  });

  it("answers 404 naming a target id that does not exist, and creates nothing", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "t" });
    for (const call of [preview, create]) {
      const result = await call(profile.id, body(["t", "ghost"]));
      expect(result).toMatchObject({ ok: false, status: 404, body: { error: "target_not_found" } });
      expect(!result.ok && result.body.message).toContain("ghost");
    }
    expect(ctx.services.db.select().from(requestsTable).all()).toEqual([]);
    expect(ctx.services.db.select().from(campaigns).all()).toEqual([]);
  });

  it("answers 409 for an explicitly chosen target the dataset retired", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "old", name: "Old Broker" });
    ctx.services.db.update(targets).set({ retired: true }).where(eq(targets.id, "old")).run();

    const result = await create(profile.id, body(["old"]));

    expect(result).toMatchObject({ ok: false, status: 409, body: { error: "target_retired" } });
    expect(ctx.services.db.select().from(campaigns).all()).toEqual([]);
  });

  it.each([
    ["no selection", { rights: ["opt_out"] }],
    ["an empty target list", { selection: { targetIds: [] }, rights: ["opt_out"] }],
    ["an unknown preset", { selection: { preset: "all_the_things" }, rights: ["opt_out"] }],
    [
      "a selection with both forms",
      { selection: { preset: "companies", targetIds: ["a"] }, rights: ["opt_out"] },
    ],
    ["no rights", { selection: { preset: "companies" }, rights: [] }],
    ["a repeated right", { selection: { preset: "companies" }, rights: ["delete", "delete"] }],
    ["an unknown right", { selection: { preset: "companies" }, rights: ["sell"] }],
  ])("answers 400 for %s", async (_name, payload) => {
    const { profile } = setup();
    for (const route of [API_ROUTES.campaignsPreview, API_ROUTES.campaignsCreate]) {
      const result = await ctx.call(route, { params: { id: profile.id }, body: payload as never });
      expect(result).toMatchObject({ ok: false, status: 400, body: { error: "invalid_request" } });
      expect(!result.ok && result.body.issues?.every((issue) => issue.path[0] === "body")).toBe(
        true,
      );
    }
  });

  it("needs a session", async () => {
    const { profile } = setup();
    seedTarget(ctx, { id: "t" });
    ctx.auth.deny();
    expect(await preview(profile.id, body(["t"]))).toMatchObject({ ok: false, status: 401 });
    ctx.auth.allow();
  });
});

describe("a large campaign", () => {
  it("handles a whole dataset in one create", async () => {
    const { profile } = setup();
    for (let i = 0; i < 120; i += 1) {
      seedTarget(ctx, {
        id: `b${i}`,
        contactMethod: i % 3 === 0 ? "unknown" : "email",
        ...(i % 3 === 0 ? { privacyEmail: null, optOutUrl: null } : {}),
      });
    }

    const created = await createOk(profile.id, {
      selection: { preset: "everything" },
      rights: ["opt_out"],
    });

    expect(created.counts).toEqual({ request_created: 80, scan_started: 0, skipped: 40 });
    expect(ctx.services.db.select().from(requestsTable).all()).toHaveLength(80);
    const [row] = ctx.services.db.select().from(campaigns).all();
    expect(row?.createdCount).toBe(80);
    expect(row?.skipped).toHaveLength(40);
  });
});
