import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/testing/justiceSupabaseSmoke.test.ts"],
    globalSetup: ["src/lib/testing/justiceSupabaseSmokeStrictGlobalSetup.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
