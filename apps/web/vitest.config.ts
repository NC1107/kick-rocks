import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

/*
 * Two projects. A `.test.ts` file runs in Node, which is right for the API client, the mock, and
 * helpers. A `.test.tsx` file runs in jsdom with Testing Library, for components and pages; it
 * starts from src/test/setup.ts and renders through src/test/render.tsx.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts", "mock/**/*.test.ts", "design/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx", "mock/**/*.test.tsx"],
          setupFiles: ["./src/test/setup.ts"],
          // The form tests type a character at a time through jsdom, which on a shared CI runner
          // takes longer than the 5 second default and then leaks half-typed input into the next test.
          testTimeout: 30_000,
        },
      },
    ],
  },
});
