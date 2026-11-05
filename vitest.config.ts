/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import path from "path";

// Minimal Vitest config — keeps test concerns out of vite.config.ts so the
// PWA/build pipeline isn't loaded for unit tests.
export default defineConfig({
  define: {
    __LAPWING_PRODUCT_PROFILE__: JSON.stringify("full"),
  },
  test: {
    globals: true,
    environment: "node",
    // App tests live under src/; also pick up pure logic extracted from Supabase
    // edge functions (Deno) so it can be unit-tested here (coverage stays src/-only).
    include: [
      "apps/web/src/**/*.{test,spec}.{ts,tsx}",
      "apps/cli/src/**/*.{test,spec}.{ts,tsx}",
      "apps/windows-companion/src/**/*.{test,spec}.{ts,tsx}",
      "packages/**/*.{test,spec}.{ts,tsx}",
      "supabase/functions/**/*.{test,spec}.ts",
      // Build tooling (CI-only, never shipped) — tested here, but kept out of the
      // src-only coverage scope below.
      "scripts/**/*.{test,spec}.ts",
    ],
    exclude: ["node_modules", "dist"],
    setupFiles: ["./apps/web/vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text-summary", "json-summary", "lcov"],
      include: [
        "apps/web/src/**/*.{ts,tsx}",
        "apps/cli/src/**/*.{ts,tsx}",
        "packages/*/src/**/*.{ts,tsx}",
      ],
      // Coverage is scoped to *logic* worth unit-testing (parsers, utilities,
      // protocol code, hooks, plugins). The React view layer is deliberately
      // out of scope — presentational components, route/page shells, and
      // context providers are validated by integration/visual testing, not
      // Vitest line coverage. We exclude view code, NOT untested logic: hooks
      // and lib/ stay in the report so the number is an honest signal.
      exclude: [
        "apps/web/src/**/*.{test,spec}.{ts,tsx}",
        "apps/web/src/components/**/*.tsx", // presentational React components (keeps video-overlays/*.ts logic in scope)
        "apps/web/src/pages/**", // route/page shells — view layer
        "apps/web/src/contexts/**", // provider wiring — view layer
        "apps/web/src/App.tsx", // app shell / routing
        "apps/web/src/components/ui/**", // vendored shadcn/ui primitives
        "apps/web/src/integrations/supabase/**", // auto-generated — DO NOT EDIT
        "apps/web/src/**/*.d.ts",
        "apps/web/src/main.tsx",
        "apps/web/src/lib/i18n/index.ts", // i18next bootstrap — side-effecting init + dynamic-import backend (like main.tsx)
        "apps/web/src/vite-env.d.ts",
        "apps/cli/src/**/*.{test,spec}.{ts,tsx}",
      "apps/windows-companion/src/**/*.{test,spec}.{ts,tsx}",
        "packages/**/*.{test,spec}.{ts,tsx}",
      ],
      // Floors guard against regressions in the logic we test. Set a few points
      // below current actuals so routine churn doesn't redden CI; ratchet up as
      // coverage grows.
      thresholds: {
        lines: 50,
        functions: 45,
        branches: 45,
        statements: 49,
      },
    },
  },
  resolve: {
    alias: {
      "@product/gopro-import": path.resolve(__dirname, "./apps/web/src/lib/gopro/goproImport.ts"),
      "@": path.resolve(__dirname, "./apps/web/src"),
    },
  },
});
