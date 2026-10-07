import { type Identity, Jurisdiction, LegalBasis } from "@kickrocks/shared";
import { describe, expect, it } from "vitest";
import { jordanIdentities } from "./builders.js";
import { createFakeLegal, FAKE_STATUTE } from "./fake-legal.js";

const legal = createFakeLegal();
const identities = jordanIdentities().map((input, index) => ({
  ...input,
  id: `i${index}`,
})) as Identity[];
const target = {
  id: "t",
  kind: "broker" as const,
  name: "Example Broker",
  category: "marketing" as const,
  domain: "t.test",
  website: null,
  optOutUrl: null,
  privacyRightsUrl: null,
  searchUrl: null,
  contactMethod: "email" as const,
  requiresId: false,
  requirements: [],
  priority: "normal" as const,
  needsRecord: false,
  californiaRegistered: false,
  retired: false,
};

const resolve = (state: "CA" | "TX", asOf: Date, rights: ("opt_out" | "delete")[] = ["opt_out"]) =>
  legal.resolveLegalBasis({ state, target, rights, asOf });

describe("fake legal", () => {
  it("gives California a statute and everyone else a policy", () => {
    const ca = resolve("CA", new Date("2026-10-07"));
    expect(LegalBasis.safeParse(ca).success).toBe(true);
    expect(ca).toMatchObject({ id: FAKE_STATUTE.id, kind: "statute", responseDays: 45 });
    expect(resolve("TX", new Date("2026-10-07"))).toMatchObject({
      id: "policy",
      kind: "policy",
      statute: null,
      responseDays: 45,
    });
  });

  it("falls back to policy before the statute takes effect", () => {
    expect(resolve("CA", new Date("2019-12-31")).kind).toBe("policy");
  });

  it("looks a stored basis up by id, in the state it belongs to", () => {
    expect(legal.getLegalBasis(FAKE_STATUTE.id, "CA")).toMatchObject({ kind: "statute" });
    expect(legal.getLegalBasis("policy", "TX")).toMatchObject({ kind: "policy", state: "TX" });
    expect(legal.getLegalBasis(FAKE_STATUTE.id, "TX")).toBeNull();
    expect(legal.getLegalBasis("no-such-law", "CA")).toBeNull();
  });

  it("lists valid jurisdictions", () => {
    for (const jurisdiction of legal.listJurisdictions())
      expect(Jurisdiction.safeParse(jurisdiction).success).toBe(true);
  });

  it("minimizes identifiers by purpose", () => {
    expect(Object.keys(legal.identifiersFor(target, identities, "email")).sort()).toEqual([
      "email",
      "full_name",
    ]);
    expect(Object.keys(legal.identifiersFor(target, identities, "scan")).sort()).toEqual([
      "city",
      "first_name",
      "last_name",
      "state",
    ]);
    expect(Object.keys(legal.identifiersFor(target, identities, "remove")).sort()).toEqual([
      "email",
      "full_name",
    ]);
  });

  it("adds only explicitly requested fields", () => {
    const fields = legal.identifiersFor(target, identities, "email", ["date_of_birth"]);
    expect(fields.date_of_birth).toBe("1990-04-05");
    expect(fields.street).toBeUndefined();
  });

  it("renders a deterministic email with the reference in the subject", () => {
    const email = legal.renderRequestEmail({
      kind: "initial",
      rights: ["opt_out", "delete"],
      reference: "KR-ABCDEF",
      basis: resolve("TX", new Date()),
      target,
      sender: { name: "Jordan Example", address: "jordan@example.com" },
      identifiers: { email: "jordan@example.com" },
    });
    expect(email.subject).toBe("opt_out and delete request KR-ABCDEF");
    expect(email.text).toContain("email: jordan@example.com");
    expect(
      legal.renderRequestEmail({
        ...{
          kind: "follow_up" as const,
          rights: ["opt_out" as const],
          reference: "KR-ABCDEF" as const,
          basis: resolve("TX", new Date()),
          target,
          sender: { name: "J", address: "j@example.com" },
          identifiers: {},
        },
      }).subject,
    ).toMatch(/^Follow-up: /);
  });
});
