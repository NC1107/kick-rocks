import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "bench/**/*.test.ts", "reply-model/**/*.test.ts"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
