import { describe, expect, it } from "vitest";
import { app, call, freshMockAppEachTest, jordan } from "./test-helpers.js";

freshMockAppEachTest();

describe("profile fixtures and handlers", () => {
  it("creates a profile and replaces its identities", async () => {
    const created = await call({
      method: "POST",
      path: "/profiles",
      body: {
        displayName: "Test Person",
        state: "OR",
        identities: [
          { kind: "name", value: { first: "Test", last: "Person" }, isPrimary: true },
          { kind: "email", value: { address: "test@example.com" }, isPrimary: true },
        ],
      },
    });
    expect(created.status).toBe(201);
    expect(created.json.primaryEmail).toBe("test@example.com");
    const list = await call({ path: "/profiles" });
    expect(list.json.profiles.length).toBe(4);
  });
});

describe("profile validation like the server", () => {
  const name = { kind: "name", value: { first: "Test", last: "Person" }, isPrimary: true };
  const email = { kind: "email", value: { address: "test@example.com" }, isPrimary: true };
  const create = (identities: unknown[]) =>
    call({
      method: "POST",
      path: "/profiles",
      body: { displayName: "Test Person", state: "OR", identities },
    });

  it("answers 400 with body-prefixed paths for a future date of birth", async () => {
    const response = await create([
      name,
      email,
      { kind: "dob", value: { date: "2999-01-01" }, isPrimary: true },
    ]);
    expect(response.status).toBe(400);
    expect(response.json.issues).toContainEqual({
      path: ["body", "identities", 2, "value", "date"],
      message: "Date of birth is not plausible",
    });
  });

  it("refuses a profile with no email or no primary name", async () => {
    expect((await create([name])).status).toBe(400);
    expect((await create([{ ...name, isPrimary: false }, email])).status).toBe(400);
  });

  it("refuses two primaries of one kind", async () => {
    const response = await create([
      name,
      email,
      { kind: "email", value: { address: "other@example.com" }, isPrimary: true },
    ]);
    expect(response.status).toBe(400);
  });

  it("applies the same rules when identities are replaced", async () => {
    const response = await call({
      method: "PUT",
      path: `/profiles/${jordan().id}/identities`,
      body: {
        identities: [name, email, { kind: "dob", value: { date: "2999-01-01" }, isPrimary: true }],
      },
    });
    expect(response.status).toBe(400);
    expect(response.json.issues[0].path.slice(0, 2)).toEqual(["body", "identities"]);
  });
});

describe("profile changes", () => {
  it("replaces identities, gives new ids, and follows the primary email", async () => {
    const before = jordan().identities.map((identity) => identity.id);
    const response = await call({
      method: "PUT",
      path: `/profiles/${jordan().id}/identities`,
      body: {
        identities: [
          { kind: "name", value: { first: "Jordan", last: "Example" }, isPrimary: true },
          { kind: "email", value: { address: "first@example.com" }, isPrimary: false },
          { kind: "email", value: { address: "second@example.com" }, isPrimary: true },
        ],
      },
    });
    expect(response.status).toBe(200);
    expect(response.json.primaryEmail).toBe("second@example.com");
    expect(response.json.identities).toHaveLength(3);
    for (const identity of response.json.identities) expect(before).not.toContain(identity.id);
  });

  it("updates the name and state, and refuses an empty patch", async () => {
    const id = jordan().id;
    const ok = await call({
      method: "PATCH",
      path: `/profiles/${id}`,
      body: { displayName: "Jordan at home", state: "OR" },
    });
    expect(ok.json).toMatchObject({ displayName: "Jordan at home", state: "OR" });
    const empty = await call({ method: "PATCH", path: `/profiles/${id}`, body: {} });
    expect(empty.status).toBe(400);
  });

  it("deletes a profile with its requests, and answers 404 afterwards", async () => {
    const id = jordan().id;
    expect(app.store.requests.some((request) => request.profileId === id)).toBe(true);
    expect((await call({ method: "DELETE", path: `/profiles/${id}` })).status).toBe(200);
    expect(app.store.requests.some((request) => request.profileId === id)).toBe(false);
    expect((await call({ path: `/profiles/${id}` })).status).toBe(404);
  });

  it("keeps a long name in the fixtures so pages meet one", async () => {
    const list = await call({ path: "/profiles" });
    const names = list.json.profiles.map((profile: { displayName: string }) => profile.displayName);
    expect(names.some((value: string) => value.length > 40)).toBe(true);
  });

  it("is rejected without the CSRF header", async () => {
    const response = await call({
      method: "PATCH",
      path: `/profiles/${jordan().id}`,
      body: { state: "WA" },
      csrf: false,
    });
    expect(response.status).toBe(403);
  });
});
