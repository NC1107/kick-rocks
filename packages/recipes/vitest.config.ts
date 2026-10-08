import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    passWithNoTests: true,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
