import { defineConfig } from "vitest/config";
import { FIXTURE_SLOTS } from "./test/fixtures/server.js";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts", "bench/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    teardownTimeout: 30_000,
    globalSetup: ["test/global-setup.ts"],
    // One fixture site per worker slot, so files can run side by side without sharing its record.
    maxWorkers: FIXTURE_SLOTS,
    // Without a terminal the default reporter says nothing until a file ends, and the browser files take minutes.
    reporters: process.stdout.isTTY ? ["default"] : ["verbose"],
  },
});
