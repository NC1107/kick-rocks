import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { webDelivery } from "./build/web-delivery.js";
import { kickRocksMock } from "./mock/plugin.js";

// `vite --mode mock` (pnpm dev:mock) answers /api/* from apps/web/mock instead of the server.
export default defineConfig(({ mode }) => {
  const mocked = mode === "mock";
  return {
    plugins: [react(), tailwindcss(), webDelivery(), ...(mocked ? [kickRocksMock()] : [])],
    server: {
      port: 5173,
      ...(mocked ? {} : { proxy: { "/api": "http://127.0.0.1:8420" } }),
    },
    build: {
      outDir: "dist",
      emptyOutDir: true,
      // React, the router, react-query, and the shared zod schemas make up the core chunk; pages load lazily.
      chunkSizeWarningLimit: 600,
      rollupOptions: {
        output: {
          // zod builds its parsers while the shared schemas load, so the jitless switch has to run
          // in the same chunk, ahead of them. Left in the entry chunk it runs after them and the
          // refused `new Function` probe reaches the console again.
          manualChunks(id) {
            if (id.endsWith("/src/jitless.ts") || id.includes("/node_modules/zod/")) return "zod";
            return undefined;
          },
        },
      },
    },
  };
});
