import { loadEnvConfig } from "@next/env";
import path from "path";
import { defineConfig } from "vitest/config";
import { JUSTICE_SUPABASE_SMOKE_INTEGRATION_DESCRIBE_NAME } from "./src/lib/testing/justiceSupabaseSmoke";

loadEnvConfig(process.cwd());

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/testing/justiceSupabaseSmoke.test.ts"],
    testNamePattern: JUSTICE_SUPABASE_SMOKE_INTEGRATION_DESCRIBE_NAME,
    globalSetup: ["src/lib/testing/justiceSupabaseSmokeStrictGlobalSetup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Next.js aliases `server-only` to a no-op in the server build; mirror that here (same as
      // vitest.config.ts) so collecting this file — which imports server-only-guarded API route
      // handlers — doesn't throw "This module cannot be imported from a Client Component module."
      "server-only": path.resolve(__dirname, "./node_modules/server-only/empty.js"),
    },
  },
});
