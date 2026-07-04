import { loadEnvConfig } from "@next/env";
import {
  getJusticeSupabaseSmokeSkipReason,
  isJusticeSupabaseSmokeConfigured,
  JUSTICE_SUPABASE_SMOKE_STRICT_RUN_ENV,
} from "@/lib/testing/justiceSupabaseSmoke";

/** Fail dedicated smoke runs before tests when configuration is incomplete. */
export default async function justiceSupabaseSmokeStrictGlobalSetup(): Promise<void> {
  loadEnvConfig(process.cwd());
  process.env[JUSTICE_SUPABASE_SMOKE_STRICT_RUN_ENV] = "1";

  if (!isJusticeSupabaseSmokeConfigured()) {
    const reason = getJusticeSupabaseSmokeSkipReason();
    console.error(`Justice Supabase smoke strict run refused: ${reason}`);
    throw new Error(`Justice Supabase smoke strict run refused: ${reason}`);
  }
}
