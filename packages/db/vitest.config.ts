import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // Migration tests boot an in-process Postgres, which is slow when the whole workspace runs in parallel.
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
