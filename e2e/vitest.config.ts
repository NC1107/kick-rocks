import { defineConfig } from "vitest/config";

// The fast checks that need no stack: the fixture files must stay valid. `pnpm e2e` runs the rest.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
  },
});
