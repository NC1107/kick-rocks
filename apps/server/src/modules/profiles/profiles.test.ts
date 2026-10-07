import { mailboxes, profiles, requests, tasks } from "@kickrocks/db";
import { API_ROUTES, type IdentityInput } from "@kickrocks/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createTestContext,
  DAY,
  jordanIdentities,
  seedMailbox,
  seedProfile,
  seedRequest,
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

const NO_DATES = { validFrom: null, validTo: null } as const;

const validBody = () => ({
  displayName: "Jordan Example",
  state: "TX" as const,
  identities: jordanIdentities(),
});

describe("access", () => {
  it("turns away an anonymous caller from every route", async () => {
    ctx.auth.deny();
    const profile = seedProfile(ctx);
    for (const route of [
      API_ROUTES.profilesList,
      API_ROUTES.profilesCreate,
      API_ROUTES.profilesGet,
      API_ROUTES.profilesUpdate,
      API_ROUTES.profilesDelete,
      API_ROUTES.profilesReplaceIdentities,
    ]) {
      const result = await ctx.call(route, {
        params: { id: profile.id },
        body: validBody() as never,
      });
      expect(result.status, route.path).toBe(401);
    }
  });

  it("requires the CSRF header to change anything", async () => {
    const profile = seedProfile(ctx);
    const response = await ctx.inject({
      method: "DELETE",
      url: `/api/profiles/${profile.id}`,
      csrf: false,
    });
    expect(response.statusCode).toBe(403);
    expect(ctx.services.db.select().from(profiles).all()).toHaveLength(1);
  });
});

describe("create", () => {
  it("stores the profile with its identities and returns the detail", async () => {
    const result = await ctx.call(API_ROUTES.profilesCreate, { body: validBody() });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.status).toBe(201);
    expect(result.body).toMatchObject({
      displayName: "Jordan Example",
      state: "TX",
      primaryEmail: "jordan@example.com",
      mailboxConnected: false,
      mailbox: null,
      createdAt: ctx.clock.now().toISOString(),
      updatedAt: ctx.clock.now().toISOString(),
    });
    expect(result.body.identities.map((identity) => identity.kind)).toEqual([
      "name",
      "email",
      "phone",
      "address",
      "dob",
    ]);
    const ids = result.body.identities.map((identity) => identity.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("trims the display name", async () => {
    const result = await ctx.call(API_ROUTES.profilesCreate, {
      body: { ...validBody(), displayName: "  Jordan  " },
    });
    expect(result.ok && result.body.displayName).toBe("Jordan");
  });

  it("answers 400 with body issues for each problem, and stores nothing", async () => {
    const result = await ctx.call(API_ROUTES.profilesCreate, {
      body: {
        displayName: "",
        state: "ZZ",
        identities: [
          { kind: "email", value: { address: "not-an-email" }, isPrimary: true, ...NO_DATES },
        ],
      } as never,
    });
    expect(result.status).toBe(400);
    if (result.ok) return;
    const paths = result.body.issues?.map((issue) => issue.path.join(".")) ?? [];
    expect(paths).toContain("body.displayName");
    expect(paths).toContain("body.state");
    expect(paths).toContain("body.identities.0.value.address");
    expect(ctx.services.db.select().from(profiles).all()).toHaveLength(0);
  });

  it("requires exactly one primary name and at least one email", async () => {
    const noName = await ctx.call(API_ROUTES.profilesCreate, {
      body: { ...validBody(), identities: jordanIdentities().filter((i) => i.kind !== "name") },
    });
    expect(noName.status).toBe(400);
    const noEmail = await ctx.call(API_ROUTES.profilesCreate, {
      body: { ...validBody(), identities: jordanIdentities().filter((i) => i.kind !== "email") },
    });
    expect(noEmail.status).toBe(400);
    const twoPrimaryNames = await ctx.call(API_ROUTES.profilesCreate, {
      body: {
        ...validBody(),
        identities: [
          ...jordanIdentities(),
          { kind: "name", value: { first: "Jo", last: "Example" }, isPrimary: true, ...NO_DATES },
        ],
      },
    });
    expect(twoPrimaryNames.status).toBe(400);
  });

  it("rejects a date of birth in the future by the clock, and accepts today", async () => {
    const withDob = (date: string): IdentityInput[] => [
      ...jordanIdentities().filter((identity) => identity.kind !== "dob"),
      { kind: "dob", value: { date }, isPrimary: true, ...NO_DATES },
    ];
    const today = ctx.clock.now().toISOString().slice(0, 10);
    const tomorrow = new Date(ctx.clock.now().getTime() + DAY).toISOString().slice(0, 10);

    const future = await ctx.call(API_ROUTES.profilesCreate, {
      body: { ...validBody(), identities: withDob(tomorrow) },
    });
    expect(future.status).toBe(400);
    if (!future.ok) {
      expect(future.body.issues?.[0]?.path).toEqual(["body", "identities", 4, "value", "date"]);
    }
    expect(
      (
        await ctx.call(API_ROUTES.profilesCreate, {
          body: { ...validBody(), identities: withDob(today) },
        })
      ).ok,
    ).toBe(true);

    ctx.clock.advance(2 * DAY);
    expect(
      (
        await ctx.call(API_ROUTES.profilesCreate, {
          body: { ...validBody(), identities: withDob(tomorrow) },
        })
      ).ok,
    ).toBe(true);
  });

  it("rejects a date of birth before 1900 and an end date before its start", async () => {
    const ancient = await ctx.call(API_ROUTES.profilesCreate, {
      body: {
        ...validBody(),
        identities: [
          ...jordanIdentities().filter((identity) => identity.kind !== "dob"),
          { kind: "dob", value: { date: "1899-12-31" }, isPrimary: true, ...NO_DATES },
        ],
      },
    });
    expect(ancient.status).toBe(400);

    const backwards = await ctx.call(API_ROUTES.profilesCreate, {
      body: {
        ...validBody(),
        identities: [
          ...jordanIdentities(),
          {
            kind: "address",
            value: { street: "1 Old Road", city: "Austin", state: "TX", zip: "78701" },
            isPrimary: false,
            validFrom: "2020-01-01",
            validTo: "2019-01-01",
          },
        ],
      },
    });
    expect(backwards.status).toBe(400);
  });

  it("rejects the same fact listed twice", async () => {
    const result = await ctx.call(API_ROUTES.profilesCreate, {
      body: {
        ...validBody(),
        identities: [
          ...jordanIdentities(),
          {
            kind: "email",
            value: { address: "JORDAN@example.com" },
            isPrimary: false,
            ...NO_DATES,
          },
        ],
      },
    });
    expect(result.status).toBe(400);
    if (!result.ok) {
      expect(result.body.issues).toContainEqual({
        path: ["body", "identities", 5],
        message: "This is listed twice",
      });
    }
  });

  it("refuses unknown kinds and malformed phone numbers and zip codes", async () => {
    const result = await ctx.call(API_ROUTES.profilesCreate, {
      body: {
        ...validBody(),
        identities: [
          ...jordanIdentities().filter((i) => i.kind !== "phone" && i.kind !== "address"),
          { kind: "phone", value: { number: "555-0123" }, isPrimary: true, ...NO_DATES },
          {
            kind: "address",
            value: { street: "1 A St", city: "Austin", state: "TX", zip: "7870" },
            isPrimary: true,
            ...NO_DATES,
          },
          { kind: "ssn", value: { number: "000" }, isPrimary: false, ...NO_DATES },
        ],
      } as never,
    });
    expect(result.status).toBe(400);
    if (result.ok) return;
    expect(result.body.issues?.length).toBeGreaterThanOrEqual(3);
  });

  it("answers 400 for no body and for a plain text body", async () => {
    const empty = await ctx.inject({ method: "POST", url: "/api/profiles" });
    expect(empty.statusCode).toBe(400);
    const wrongType = await ctx.inject({
      method: "POST",
      url: "/api/profiles",
      payload: "hello",
      headers: { "content-type": "text/plain" },
    });
    expect(wrongType.statusCode).toBe(400);
    expect(ctx.services.db.select().from(profiles).all()).toHaveLength(0);
  });
});

describe("list and get", () => {
  it("lists profiles oldest first with their primary email and mailbox flag", async () => {
    const first = seedProfile(ctx, { displayName: "Jordan Example" });
    ctx.clock.advance(DAY);
    const second = seedProfile(ctx, {
      displayName: "Riley Sample",
      identities: [
        { kind: "name", value: { first: "Riley", last: "Sample" }, isPrimary: true, ...NO_DATES },
        {
          kind: "email",
          value: { address: "riley.old@example.net" },
          isPrimary: false,
          ...NO_DATES,
        },
        { kind: "email", value: { address: "riley@example.net" }, isPrimary: true, ...NO_DATES },
      ],
    });
    seedMailbox(ctx, second.id);

    const result = await ctx.call(API_ROUTES.profilesList);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.profiles.map((profile) => profile.id)).toEqual([first.id, second.id]);
    expect(result.body.profiles[0]).toMatchObject({
      primaryEmail: "jordan@example.com",
      mailboxConnected: false,
    });
    expect(result.body.profiles[1]).toMatchObject({
      primaryEmail: "riley@example.net",
      mailboxConnected: true,
    });
    expect(result.body.profiles[0]).not.toHaveProperty("identities");
  });

  it("falls back to the first email when none is marked primary", async () => {
    const profile = seedProfile(ctx, {
      identities: [
        { kind: "name", value: { first: "Jo", last: "Example" }, isPrimary: true, ...NO_DATES },
        { kind: "email", value: { address: "first@example.com" }, isPrimary: false, ...NO_DATES },
        { kind: "email", value: { address: "second@example.com" }, isPrimary: false, ...NO_DATES },
      ],
    });
    const result = await ctx.call(API_ROUTES.profilesGet, { params: { id: profile.id } });
    expect(result.ok && result.body.primaryEmail).toBe("first@example.com");
  });

  it("returns an empty list on a fresh instance", async () => {
    const result = await ctx.call(API_ROUTES.profilesList);
    expect(result.ok && result.body.profiles).toEqual([]);
  });

  it("returns the detail with the mailbox but never its password or cursor", async () => {
    const profile = seedProfile(ctx);
    const mailbox = seedMailbox(ctx, profile.id, { secret: "super-secret-app-password" });
    const result = await ctx.call(API_ROUTES.profilesGet, { params: { id: profile.id } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.mailbox).toMatchObject({ id: mailbox.id, profileId: profile.id });
    expect(JSON.stringify(result.response.json())).not.toContain("super-secret-app-password");
    expect(result.body.mailbox).not.toHaveProperty("secret");
    expect(result.body.mailbox).not.toHaveProperty("lastPollUid");
  });

  it("answers 404 for a profile that does not exist", async () => {
    const result = await ctx.call(API_ROUTES.profilesGet, { params: { id: "missing" } });
    expect(result.status).toBe(404);
    if (!result.ok) expect(result.body.error).toBe("profile_not_found");
  });
});

describe("update", () => {
  it("changes the name and state, bumps updatedAt, and keeps the rest", async () => {
    const profile = seedProfile(ctx);
    ctx.clock.advance(DAY);
    const result = await ctx.call(API_ROUTES.profilesUpdate, {
      params: { id: profile.id },
      body: { displayName: "J. Example", state: "CA" },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      displayName: "J. Example",
      state: "CA",
      createdAt: profile.createdAt,
      updatedAt: ctx.clock.now().toISOString(),
    });
    expect(result.body.identities).toHaveLength(5);
  });

  it("changes one field without touching the other", async () => {
    const profile = seedProfile(ctx, { state: "TX" });
    const result = await ctx.call(API_ROUTES.profilesUpdate, {
      params: { id: profile.id },
      body: { displayName: "Only Name" },
    });
    expect(result.ok && result.body).toMatchObject({ displayName: "Only Name", state: "TX" });
  });

  it("rejects an empty patch, a bad state, and a blank name", async () => {
    const profile = seedProfile(ctx);
    for (const body of [{}, { state: "ZZ" }, { displayName: "   " }]) {
      const result = await ctx.call(API_ROUTES.profilesUpdate, {
        params: { id: profile.id },
        body: body as never,
      });
      expect(result.status, JSON.stringify(body)).toBe(400);
    }
  });

  it("answers 404 for a profile that does not exist", async () => {
    const result = await ctx.call(API_ROUTES.profilesUpdate, {
      params: { id: "missing" },
      body: { displayName: "Nobody" },
    });
    expect(result.status).toBe(404);
  });
});

describe("replace identities", () => {
  it("replaces the set in the order sent and bumps updatedAt", async () => {
    const profile = seedProfile(ctx);
    ctx.clock.advance(DAY);
    const reordered = [...jordanIdentities()].reverse();
    const result = await ctx.call(API_ROUTES.profilesReplaceIdentities, {
      params: { id: profile.id },
      body: { identities: reordered },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body.identities.map((identity) => identity.kind)).toEqual(
      reordered.map((identity) => identity.kind),
    );
    expect(result.body.updatedAt).toBe(ctx.clock.now().toISOString());
  });

  it("keeps the id of an identity that did not change, so a queued scan still finds it", async () => {
    const profile = seedProfile(ctx);
    const before = profile.identities;
    const next: IdentityInput[] = [
      ...jordanIdentities().filter((identity) => identity.kind !== "address"),
      {
        kind: "address",
        value: { street: "9 New Street", city: "Dallas", state: "TX", zip: "75001" },
        isPrimary: true,
        ...NO_DATES,
      },
    ];
    const result = await ctx.call(API_ROUTES.profilesReplaceIdentities, {
      params: { id: profile.id },
      body: { identities: next },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const kind of ["name", "email", "phone", "dob"] as const) {
      const old = before.find((identity) => identity.kind === kind);
      const now = result.body.identities.find((identity) => identity.kind === kind);
      expect(now?.id, kind).toBe(old?.id);
    }
    const oldAddress = before.find((identity) => identity.kind === "address");
    expect(result.body.identities.map((identity) => identity.id)).not.toContain(oldAddress?.id);
  });

  it("keeps ids when only validity dates or the primary flag change", async () => {
    const profile = seedProfile(ctx);
    const nameId = profile.identities.find((identity) => identity.kind === "name")?.id;
    const next = jordanIdentities().map((identity) =>
      identity.kind === "name" ? { ...identity, validFrom: "2010-01-01" } : identity,
    );
    const result = await ctx.call(API_ROUTES.profilesReplaceIdentities, {
      params: { id: profile.id },
      body: { identities: next },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const name = result.body.identities.find((identity) => identity.kind === "name");
    expect(name).toMatchObject({ id: nameId, validFrom: "2010-01-01" });
  });

  it("matches two identical-valued facts one to one", async () => {
    const profile = seedProfile(ctx);
    const twoNames: IdentityInput[] = [
      ...jordanIdentities(),
      { kind: "alias", value: { first: "Jordan", last: "Example" }, isPrimary: false, ...NO_DATES },
    ];
    const first = await ctx.call(API_ROUTES.profilesReplaceIdentities, {
      params: { id: profile.id },
      body: { identities: twoNames },
    });
    const second = await ctx.call(API_ROUTES.profilesReplaceIdentities, {
      params: { id: profile.id },
      body: { identities: twoNames },
    });
    expect(first.ok && second.ok && second.body.identities.map((i) => i.id)).toEqual(
      first.ok && first.body.identities.map((i) => i.id),
    );
  });

  it("leaves the stored identities alone when the new set is invalid", async () => {
    const profile = seedProfile(ctx);
    const result = await ctx.call(API_ROUTES.profilesReplaceIdentities, {
      params: { id: profile.id },
      body: { identities: jordanIdentities().filter((identity) => identity.kind !== "email") },
    });
    expect(result.status).toBe(400);
    const stored = await ctx.call(API_ROUTES.profilesGet, { params: { id: profile.id } });
    expect(stored.ok && stored.body.identities.map((identity) => identity.id)).toEqual(
      profile.identities.map((identity) => identity.id),
    );
  });

  it("applies the future date of birth rule with body paths", async () => {
    const profile = seedProfile(ctx);
    const result = await ctx.call(API_ROUTES.profilesReplaceIdentities, {
      params: { id: profile.id },
      body: {
        identities: [
          ...jordanIdentities().filter((identity) => identity.kind !== "dob"),
          { kind: "dob", value: { date: "2999-01-01" }, isPrimary: true, ...NO_DATES },
        ],
      },
    });
    expect(result.status).toBe(400);
    if (!result.ok)
      expect(result.body.issues?.[0]?.path.slice(0, 3)).toEqual(["body", "identities", 4]);
  });

  it("answers 404 for a profile that does not exist", async () => {
    const result = await ctx.call(API_ROUTES.profilesReplaceIdentities, {
      params: { id: "missing" },
      body: { identities: jordanIdentities() },
    });
    expect(result.status).toBe(404);
  });

  it("refuses more than sixty identities", async () => {
    const profile = seedProfile(ctx);
    const many = Array.from({ length: 61 }, (_, i) => ({
      kind: "email" as const,
      value: { address: `person${i}@example.com` },
      isPrimary: false,
      ...NO_DATES,
    }));
    const result = await ctx.call(API_ROUTES.profilesReplaceIdentities, {
      params: { id: profile.id },
      body: { identities: [...jordanIdentities(), ...many] },
    });
    expect(result.status).toBe(400);
  });
});

describe("delete", () => {
  it("removes the profile with its identities, mailbox, requests, and tasks", async () => {
    const profile = seedProfile(ctx);
    const keep = seedProfile(ctx, { displayName: "Riley Sample" });
    seedMailbox(ctx, profile.id);
    const target = seedTarget(ctx);
    const request = seedRequest(ctx, { profileId: profile.id, targetId: target.id });
    seedTask(ctx, {
      kind: "form",
      profileId: profile.id,
      requestId: request.id,
      targetId: target.id,
      payload: { requestId: request.id, targetId: target.id, recipeId: null, recordUrl: null },
    });

    const result = await ctx.call(API_ROUTES.profilesDelete, { params: { id: profile.id } });
    expect(result.ok && result.body).toEqual({ ok: true });

    const { db } = ctx.services;
    expect(
      db
        .select()
        .from(profiles)
        .all()
        .map((row) => row.id),
    ).toEqual([keep.id]);
    expect(db.select().from(mailboxes).all()).toHaveLength(0);
    expect(db.select().from(requests).all()).toHaveLength(0);
    expect(db.select().from(tasks).all()).toHaveLength(0);
    expect((await ctx.call(API_ROUTES.profilesGet, { params: { id: profile.id } })).status).toBe(
      404,
    );
  });

  it("leaves the target in place", async () => {
    const profile = seedProfile(ctx);
    const target = seedTarget(ctx);
    seedRequest(ctx, { profileId: profile.id, targetId: target.id });
    await ctx.call(API_ROUTES.profilesDelete, { params: { id: profile.id } });
    expect(ctx.services.targets.get(target.id)).toBeTruthy();
  });

  it("answers 404 the second time", async () => {
    const profile = seedProfile(ctx);
    expect((await ctx.call(API_ROUTES.profilesDelete, { params: { id: profile.id } })).ok).toBe(
      true,
    );
    expect((await ctx.call(API_ROUTES.profilesDelete, { params: { id: profile.id } })).status).toBe(
      404,
    );
  });
});
