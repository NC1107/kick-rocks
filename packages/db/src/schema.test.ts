import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "./open.js";
import * as schema from "./schema.js";

const NOW = "2026-10-07T00:00:00.000Z";

let dir: string;
let opened: OpenedDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kickrocks-schema-"));
  opened = openDatabase({ dbPath: join(dir, "kickrocks.db"), keyPath: join(dir, "db.key") });
});

afterEach(() => {
  opened.close();
  rmSync(dir, { recursive: true, force: true });
});

function addProfile(id = "p1") {
  opened.db
    .insert(schema.profiles)
    .values({ id, displayName: "Jordan Example", state: "TX", createdAt: NOW, updatedAt: NOW })
    .run();
}

function addTarget(id = "t1", domain = "example.com") {
  opened.db
    .insert(schema.targets)
    .values({
      id,
      kind: "broker",
      name: "Example",
      category: "marketing",
      domain,
      contactMethod: "email",
      region: "us",
      requirements: [],
      priority: "normal",
      data: {} as never,
      datasetVersion: "v1",
      createdAt: NOW,
    })
    .run();
}

function addRequest(id = "r1", reference = "KR-AAAAAA") {
  opened.db
    .insert(schema.requests)
    .values({
      id,
      profileId: "p1",
      targetId: "t1",
      rights: ["opt_out"],
      legalBasis: "policy",
      channel: "email",
      status: "draft",
      reference,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

function addTask(
  id: string,
  status: (typeof schema.tasks.$inferInsert)["status"],
  dedupeKey: string | null,
) {
  opened.db
    .insert(schema.tasks)
    .values({
      id,
      kind: "email_send",
      status,
      payload: { requestId: "r1", followUp: false },
      maxAttempts: 3,
      dedupeKey,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
}

describe("tasks dedupe index", () => {
  it.each(["queued", "leased", "blocked"] as const)(
    "rejects a second %s task with the same key",
    (status) => {
      addTask("a", status, "email_send:r1");
      expect(() => addTask("b", "queued", "email_send:r1")).toThrow(/UNIQUE/);
    },
  );

  it.each(["done", "failed", "cancelled"] as const)(
    "does not hold the key once a task is %s",
    (status) => {
      addTask("a", status, "email_send:r1");
      expect(() => addTask("b", "queued", "email_send:r1")).not.toThrow();
    },
  );

  it("frees the key when a live task finishes", () => {
    addTask("a", "queued", "k");
    opened.db.update(schema.tasks).set({ status: "done" }).where(eq(schema.tasks.id, "a")).run();
    expect(() => addTask("b", "queued", "k")).not.toThrow();
  });

  it("refuses to revive a finished task into a taken key", () => {
    addTask("a", "done", "k");
    addTask("b", "queued", "k");
    expect(() =>
      opened.db
        .update(schema.tasks)
        .set({ status: "queued" })
        .where(eq(schema.tasks.id, "a"))
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it("lets tasks without a key coexist", () => {
    addTask("a", "queued", null);
    expect(() => addTask("b", "queued", null)).not.toThrow();
  });

  it("lets different keys coexist", () => {
    addTask("a", "queued", "k1");
    expect(() => addTask("b", "queued", "k2")).not.toThrow();
  });
});

describe("constraints", () => {
  it("keeps request references unique", () => {
    addProfile();
    addTarget();
    addRequest("r1", "KR-AAAAAA");
    expect(() => addRequest("r2", "KR-AAAAAA")).toThrow(/UNIQUE/);
  });

  it("keeps one target per kind and domain", () => {
    addTarget("a", "example.com");
    expect(() => addTarget("b", "example.com")).toThrow(/UNIQUE/);
  });

  it("allows one mailbox per profile", () => {
    addProfile();
    const mailbox = {
      profileId: "p1",
      provider: "other",
      address: "a@example.com",
      username: "a@example.com",
      secret: "s",
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpSecure: false,
      imapHost: "imap.example.com",
      imapPort: 993,
      dailyCap: 50,
      createdAt: NOW,
    };
    opened.db
      .insert(schema.mailboxes)
      .values({ id: "m1", ...mailbox })
      .run();
    expect(() =>
      opened.db
        .insert(schema.mailboxes)
        .values({ id: "m2", ...mailbox })
        .run(),
    ).toThrow(/UNIQUE/);
  });

  it("enforces foreign keys", () => {
    expect(() =>
      opened.db
        .insert(schema.identities)
        .values({
          id: "i1",
          profileId: "missing",
          kind: "email",
          value: { address: "a@example.com" },
        })
        .run(),
    ).toThrow(/FOREIGN KEY/);
  });

  it("cascades a profile delete through everything it owns", () => {
    addProfile();
    addTarget();
    addRequest();
    opened.db
      .insert(schema.requestEvents)
      .values({
        id: "e1",
        requestId: "r1",
        type: "created",
        actor: "system",
        payload: null,
        createdAt: NOW,
      })
      .run();
    opened.db
      .insert(schema.tasks)
      .values({
        id: "k1",
        kind: "form",
        profileId: "p1",
        requestId: "r1",
        payload: {},
        maxAttempts: 3,
        createdAt: NOW,
        updatedAt: NOW,
      })
      .run();
    opened.db
      .insert(schema.taskArtifacts)
      .values({
        id: "x1",
        taskId: "k1",
        kind: "screenshot",
        mime: "image/png",
        data: Buffer.from([1, 2, 3]),
        createdAt: NOW,
      })
      .run();

    opened.db.delete(schema.profiles).where(eq(schema.profiles.id, "p1")).run();

    expect(opened.db.select().from(schema.requests).all()).toEqual([]);
    expect(opened.db.select().from(schema.requestEvents).all()).toEqual([]);
    expect(opened.db.select().from(schema.tasks).all()).toEqual([]);
    expect(opened.db.select().from(schema.taskArtifacts).all()).toEqual([]);
    expect(opened.db.select().from(schema.targets).all()).toHaveLength(1);
  });

  it("keeps a message when its request goes away", () => {
    addProfile();
    addTarget();
    addRequest();
    opened.db
      .insert(schema.mailboxes)
      .values({
        id: "m1",
        profileId: "p1",
        provider: "other",
        address: "a@example.com",
        username: "a@example.com",
        secret: "s",
        smtpHost: "h",
        smtpPort: 587,
        smtpSecure: false,
        imapHost: "h",
        imapPort: 993,
        dailyCap: 50,
        createdAt: NOW,
      })
      .run();
    opened.db
      .insert(schema.messages)
      .values({
        id: "msg1",
        mailboxId: "m1",
        imapUid: 1,
        uidValidity: 7,
        requestId: "r1",
        fromAddress: "privacy@example.com",
        subject: "Re: KR-AAAAAA",
        receivedAt: NOW,
        classification: "completed",
        confidence: 0.9,
        links: [],
        createdAt: NOW,
      })
      .run();
    opened.db.delete(schema.requests).where(eq(schema.requests.id, "r1")).run();
    const [message] = opened.db.select().from(schema.messages).all();
    expect(message?.requestId).toBeNull();
    expect(message?.reviewed).toBe(false);
  });

  it("deduplicates messages per mailbox, UIDVALIDITY, and UID", () => {
    addProfile();
    opened.db
      .insert(schema.mailboxes)
      .values({
        id: "m1",
        profileId: "p1",
        provider: "other",
        address: "a@example.com",
        username: "a@example.com",
        secret: "s",
        smtpHost: "h",
        smtpPort: 587,
        smtpSecure: false,
        imapHost: "h",
        imapPort: 993,
        dailyCap: 50,
        createdAt: NOW,
      })
      .run();
    const message = (id: string, uidValidity: number) => ({
      id,
      mailboxId: "m1",
      imapUid: 1,
      uidValidity,
      fromAddress: "a@example.com",
      subject: "s",
      receivedAt: NOW,
      classification: "unknown" as const,
      confidence: 0,
      links: [],
      createdAt: NOW,
    });
    opened.db.insert(schema.messages).values(message("a", 1)).run();
    expect(() => opened.db.insert(schema.messages).values(message("b", 1)).run()).toThrow(/UNIQUE/);
    expect(() => opened.db.insert(schema.messages).values(message("c", 2)).run()).not.toThrow();
  });
});

describe("json columns", () => {
  it("round-trips typed json", () => {
    addProfile();
    opened.db
      .insert(schema.identities)
      .values({
        id: "i1",
        profileId: "p1",
        kind: "address",
        value: { street: "1 Main St", city: "Austin", state: "TX", zip: "78701" },
        isPrimary: true,
      })
      .run();
    const [row] = opened.db.select().from(schema.identities).all();
    expect(row?.value).toEqual({ street: "1 Main St", city: "Austin", state: "TX", zip: "78701" });
    expect(row?.isPrimary).toBe(true);
  });

  it("stores screenshot bytes exactly", () => {
    addTask("k1", "blocked", null);
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 255]);
    opened.db
      .insert(schema.taskArtifacts)
      .values({
        id: "x1",
        taskId: "k1",
        kind: "screenshot",
        mime: "image/png",
        data: bytes,
        createdAt: NOW,
      })
      .run();
    const [row] = opened.db.select().from(schema.taskArtifacts).all();
    expect(Buffer.compare(row?.data ?? Buffer.alloc(0), bytes)).toBe(0);
  });
});
