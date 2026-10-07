import { defineConfig } from "vitest/config";

// One journey, in order, against the stack that run.mjs started. Steps share state on purpose, so
// files and tests never run in parallel and a failed step stops the rest from running on bad ground.
export default defineConfig({
  test: {
    include: ["tests/**/*.e2e.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 90_000,
    hookTimeout: 120_000,
    bail: 1,
  },
});
