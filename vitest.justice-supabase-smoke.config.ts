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
    },
  },
});
