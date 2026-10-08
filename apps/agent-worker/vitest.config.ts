import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    globalSetup: ["test/global-setup.ts"],
    // The fixture site keeps one record of what was submitted, so two files must not share it at once.
    fileParallelism: false,
  },
});
