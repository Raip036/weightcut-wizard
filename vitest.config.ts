import { defineConfig } from "vitest/config";
import path from "path";

// Vitest config for the nutrition-overhaul-v2 test suite.
// - Node environment: we avoid jsdom/happy-dom (not installed) and render React
//   components via react-dom/server for output assertions.
// - @ alias mirrors vite.config.ts so "@/…" imports resolve.
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "edge-runtime",
    globals: false,
    include: [
      "tests/**/*.{spec,test}.{ts,tsx}",
      "src/**/__tests__/**/*.{spec,test}.{ts,tsx}",
      "src/**/*.{spec,test}.{ts,tsx}",
      "convex/**/__tests__/**/*.{spec,test}.{ts,tsx}",
    ],
    // convex-test runs against a mocked Convex backend; needs the edge runtime
    // for compatibility with how Convex bundles server code.
    server: { deps: { inline: ["convex-test"] } },
    // Security RLS suite hits a live Supabase test project; skipped cleanly
    // when env vars are absent, so default testTimeout stays conservative.
    testTimeout: 15_000,
  },
});
