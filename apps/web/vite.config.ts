import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { kickRocksMock } from "./mock/plugin.js";

// `vite --mode mock` (pnpm dev:mock) answers /api/* from apps/web/mock instead of the server.
export default defineConfig(({ mode }) => {
  const mocked = mode === "mock";
  return {
    plugins: [react(), tailwindcss(), ...(mocked ? [kickRocksMock()] : [])],
    server: {
      port: 5173,
      ...(mocked ? {} : { proxy: { "/api": "http://127.0.0.1:8420" } }),
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // React, the router, react-query, and the shared zod schemas make up the core chunk; pages load lazily.
      chunkSizeWarningLimit: 600,
    },
  };
});
