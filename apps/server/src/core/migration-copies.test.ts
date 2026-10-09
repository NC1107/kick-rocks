import { existsSync, utimesSync, writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestContext, DAY, type TestContext } from "../test-utils/index.js";
import { BACKUP_MARKER } from "./health.js";
import { MIGRATION_COPY_MAX_AGE_MS, removeStaleMigrationCopies } from "./migration-copies.js";

let ctx: TestContext;
let copy: string;

beforeEach(async () => {
  ctx = await createTestContext();
  copy = `${ctx.services.config.dbPath}.before-0008_x`;
  writeFileSync(copy, "an older database");
  const madeAt = new Date(ctx.clock.now().getTime() - DAY);
  utimesSync(copy, madeAt, madeAt);
});

afterEach(async () => {
  await ctx.close();
});

describe("removeStaleMigrationCopies", () => {
  it("keeps a young copy while no backup is newer than it", () => {
    expect(removeStaleMigrationCopies(ctx.services)).toBe(0);
    expect(existsSync(copy)).toBe(true);
  });

  it("removes the copy once a verified backup is newer than the migration", () => {
    writeFileSync(`${ctx.services.config.dataDir}/${BACKUP_MARKER}`, ctx.clock.now().toISOString());
    expect(removeStaleMigrationCopies(ctx.services)).toBe(1);
    expect(existsSync(copy)).toBe(false);
  });

  it("removes the copy once it is older than the retention age", () => {
    ctx.clock.advance(MIGRATION_COPY_MAX_AGE_MS);
    expect(removeStaleMigrationCopies(ctx.services)).toBe(1);
  });
});
