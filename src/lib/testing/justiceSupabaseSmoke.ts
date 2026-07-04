import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { JusticeIntake, TimelineEntry } from "@/lib/justice/types";

export const JUSTICE_SUPABASE_SMOKE_ENABLED_ENV = "JUSTICE_SUPABASE_SMOKE_ENABLED";
export const JUSTICE_SUPABASE_SMOKE_CLERK_USER_ID_ENV = "JUSTICE_SUPABASE_SMOKE_CLERK_USER_ID";
export const JUSTICE_SUPABASE_SMOKE_FORBIDDEN_PROJECT_REF_ENV =
  "JUSTICE_SUPABASE_SMOKE_FORBIDDEN_PROJECT_REF";

const SUPABASE_HOST_SUFFIX = ".supabase.co";

/** True when the opt-in Supabase justice persistence smoke may run. */
export function isJusticeSupabaseSmokeConfigured(): boolean {
  return getJusticeSupabaseSmokeMissingEnvVars().length === 0 && !isJusticeSupabaseSmokeBlocked();
}

/** Human-readable reason the smoke is skipped or blocked. */
export function getJusticeSupabaseSmokeSkipReason(): string {
  if (isDeployedProduction()) {
    return "Refused: justice Supabase smoke cannot run when VERCEL_ENV=production.";
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const projectRef = extractSupabaseProjectRef(supabaseUrl);
  if (projectRef && isSupabaseProjectRefBlockedForSmoke(projectRef)) {
    return `Refused: Supabase project ref "${projectRef}" is blocked by ${JUSTICE_SUPABASE_SMOKE_FORBIDDEN_PROJECT_REF_ENV}.`;
  }

  const missing = getJusticeSupabaseSmokeMissingEnvVars();
  if (missing.length > 0) {
    return `Skipped: missing justice Supabase smoke credentials — ${missing.join(", ")}.`;
  }

  return "Justice Supabase smoke is configured.";
}

export function isDeployedProduction(): boolean {
  return process.env.VERCEL_ENV === "production";
}

/** Parse https://<project-ref>.supabase.co into the project ref, or null when invalid. */
export function extractSupabaseProjectRef(supabaseUrl: string): string | null {
  const trimmed = supabaseUrl.trim();
  if (!trimmed) return null;
  try {
    const host = new URL(trimmed).hostname.toLowerCase();
    if (!host.endsWith(SUPABASE_HOST_SUFFIX)) return null;
    const ref = host.slice(0, -SUPABASE_HOST_SUFFIX.length);
    return ref.length > 0 ? ref : null;
  } catch {
    return null;
  }
}

/** Block smoke against an explicit production project ref when configured. */
export function isSupabaseProjectRefBlockedForSmoke(projectRef: string): boolean {
  const forbidden = process.env[JUSTICE_SUPABASE_SMOKE_FORBIDDEN_PROJECT_REF_ENV]?.trim();
  if (!forbidden) return false;
  return projectRef.trim() === forbidden;
}

function isJusticeSupabaseSmokeBlocked(): boolean {
  if (isDeployedProduction()) return true;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const projectRef = extractSupabaseProjectRef(supabaseUrl);
  if (!projectRef) return true;
  if (isSupabaseProjectRefBlockedForSmoke(projectRef)) return true;

  return false;
}

/** Lists env vars that are missing or invalid for the opt-in smoke. */
export function getJusticeSupabaseSmokeMissingEnvVars(): string[] {
  const missing: string[] = [];

  if (process.env[JUSTICE_SUPABASE_SMOKE_ENABLED_ENV]?.trim() !== "1") {
    missing.push(`${JUSTICE_SUPABASE_SMOKE_ENABLED_ENV}=1`);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  if (!supabaseUrl) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL");
  } else if (!extractSupabaseProjectRef(supabaseUrl)) {
    missing.push("NEXT_PUBLIC_SUPABASE_URL (valid https://<ref>.supabase.co URL)");
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
    missing.push("SUPABASE_SERVICE_ROLE_KEY");
  }

  const clerkUserId = process.env[JUSTICE_SUPABASE_SMOKE_CLERK_USER_ID_ENV]?.trim() ?? "";
  if (!clerkUserId) {
    missing.push(`${JUSTICE_SUPABASE_SMOKE_CLERK_USER_ID_ENV} (Clerk user id owning test rows)`);
  }

  return missing;
}

export function buildJusticeSupabaseSmokeRunId(): string {
  return `smoke_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/** Valid intake payload with a unique company name for list assertions and cleanup. */
export function buildJusticeSupabaseSmokeIntake(runId: string): JusticeIntake {
  return {
    problem_category: "online_purchase",
    company_name: `SmokeCo ${runId}`,
    company_website: "",
    purchase_or_signup: "persistence smoke order",
    story: `Justice Supabase persistence smoke ${runId}`,
    money_involved: "$1.00",
    pay_or_order_date: "",
    order_confirmation_details: "",
    user_display_name: "Smoke Test User",
    reply_email: "justice-supabase-smoke@example.com",
    already_contacted: "no",
  };
}

export function buildJusticeSupabaseSmokeCaseStartedTimeline(
  caseId: string,
  runId: string
): TimelineEntry[] {
  const ts = new Date().toISOString();
  return [
    {
      id: `smoke_case_started_${runId}`,
      case_id: caseId,
      type: "case_started",
      label: "Case started",
      ts,
    },
  ];
}

/** Minimal client_state shape used after draft review in the signed-in roundtrip. */
export function buildJusticeSupabaseSmokeClientState(runId: string): Record<string, unknown> {
  return {
    approved_next_action: {
      status: "approved",
      href: "/justice/bbb",
      destination_id: "bbb",
      label: `Smoke BBB action ${runId}`,
    },
  };
}

export function createJusticeSupabaseSmokeAdminClient(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!supabaseUrl || !supabaseServiceRoleKey) return null;

  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
}

/** Service-role cleanup only — not part of the user-facing API lifecycle under test. */
export async function deleteJusticeSupabaseSmokeCase(caseId: string): Promise<void> {
  const supabase = createJusticeSupabaseSmokeAdminClient();
  if (!supabase) {
    throw new Error("Supabase admin client unavailable for smoke cleanup.");
  }

  const { error } = await supabase.from("justice_cases").delete().eq("id", caseId);
  if (error) {
    throw new Error(`Failed to delete smoke case ${caseId}: ${error.message}`);
  }
}

/** Playwright mock env keys that must stay off for real Supabase persistence. */
export const PLAYWRIGHT_JUSTICE_MOCK_ENV_KEYS = [
  "PLAYWRIGHT_MOCK_INTAKE_CASE_COMMIT_PIPELINE",
  "PLAYWRIGHT_MOCK_INTAKE_CASE_HYDRATION_PIPELINE",
  "PLAYWRIGHT_MOCK_JUSTICE_ARCHIVED_CASES_LIST_PIPELINE",
  "PLAYWRIGHT_MOCK_JUSTICE_SAVED_CASES_LIST_PIPELINE",
] as const;

/** Clears Playwright justice mock flags so route handlers hit Supabase. */
export function disablePlaywrightJusticeMockEnvForSmoke(): void {
  for (const key of PLAYWRIGHT_JUSTICE_MOCK_ENV_KEYS) {
    delete process.env[key];
  }
}
