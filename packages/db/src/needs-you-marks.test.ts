import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type OpenedDatabase, openDatabase } from "./open.js";
import * as schema from "./schema.js";

const NOW = "2026-10-07T00:00:00.000Z";

let dir: string;
let opened: OpenedDatabase;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kickrocks-marks-"));
  opened = openDatabase({ dbPath: join(dir, "kickrocks.db"), keyPath: join(dir, "db.key") });
  opened.db
    .insert(schema.profiles)
    .values({ id: "p1", displayName: "Jordan", state: "TX", createdAt: NOW, updatedAt: NOW })
    .run();
  opened.db
    .insert(schema.tasks)
    .values({
      id: "t1",
      kind: "agent",
      status: "blocked",
      profileId: "p1",
      payload: {},
      maxAttempts: 3,
      createdAt: NOW,
      updatedAt: NOW,
    })
    .run();
});

afterEach(() => {
  opened.close();
  rmSync(dir, { recursive: true, force: true });
});

const mark = (id: string, subject: Partial<typeof schema.needsYouMarks.$inferInsert>) =>
  opened.db
    .insert(schema.needsYouMarks)
    .values({ id, profileId: "p1", createdAt: NOW, updatedAt: NOW, ...subject })
    .run();

describe("needs_you_marks", () => {
  it("holds a mark for one task", () => {
    mark("m1", { taskId: "t1" });
    expect(opened.db.select().from(schema.needsYouMarks).all()).toHaveLength(1);
  });

  it("allows one mark per task", () => {
    mark("m1", { taskId: "t1" });
    expect(() => mark("m2", { taskId: "t1" })).toThrow(/UNIQUE/);
  });

  it("rejects a row with no subject", () => {
    expect(() => mark("m1", {})).toThrow(/CHECK/);
  });

  it("rejects a row with two subjects", () => {
    opened.db.run(sql`PRAGMA foreign_keys = OFF`);
    try {
      expect(() => mark("m1", { taskId: "t1", matchId: "x" })).toThrow(/CHECK/);
    } finally {
      opened.db.run(sql`PRAGMA foreign_keys = ON`);
    }
  });

  it("goes when its task goes", () => {
    mark("m1", { taskId: "t1" });
    opened.db.delete(schema.tasks).where(eq(schema.tasks.id, "t1")).run();
    expect(opened.db.select().from(schema.needsYouMarks).all()).toEqual([]);
  });

  it("goes when its profile goes", () => {
    mark("m1", { taskId: "t1" });
    opened.db.delete(schema.profiles).where(eq(schema.profiles.id, "p1")).run();
    expect(opened.db.select().from(schema.needsYouMarks).all()).toEqual([]);
  });
});
