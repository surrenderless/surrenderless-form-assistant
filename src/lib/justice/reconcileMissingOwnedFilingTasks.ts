import type { SupabaseClient } from "@supabase/supabase-js";
import { isJusticeIntakePayload } from "@/lib/justice/caseApiValidation";
import {
  ensureOwnedFilingTaskAfterClientStateWrite,
  resolveRequiredOwnedFilingTaskKind,
  type OwnedFilingTaskKind,
} from "@/lib/justice/ensureOwnedFilingTaskAfterClientStateWrite";
import type { JusticeIntake } from "@/lib/justice/types";

const CASE_SELECT = "id, user_id, intake, client_state, archived_at, payment_dispute_draft" as const;

export type ReconcileMissingOwnedFilingTaskResult = {
  case_id: string;
  user_id: string;
  kind: "created" | "already_present" | "failed" | "skipped";
  filing_kind?: OwnedFilingTaskKind;
  reason?: "archived" | "no_owned_step" | "invalid" | "ensure_failed";
};

export type ReconcileMissingOwnedFilingTasksSummary = {
  scanned: number;
  needing_owned_filing: number;
  created: number;
  already_present: number;
  failed: number;
  skipped: number;
  results: ReconcileMissingOwnedFilingTaskResult[];
};

/**
 * Finds non-archived cases whose client_state requires a Surrenderless-owned filing task
 * that is missing, and creates it via idempotent ensureOwnedFilingTaskAfterClientStateWrite.
 */
export async function reconcileMissingOwnedFilingTasks(
  supabase: SupabaseClient,
  options: { limit?: number } = {}
): Promise<ReconcileMissingOwnedFilingTasksSummary> {
  const limit = options.limit ?? 100;
  const results: ReconcileMissingOwnedFilingTaskResult[] = [];

  const { data: caseRows, error: casesErr } = await supabase
    .from("justice_cases")
    .select(CASE_SELECT)
    .is("archived_at", null)
    .order("updated_at", { ascending: false })
    .limit(limit);

  if (casesErr) {
    console.warn("reconcile owned filing tasks: list cases", casesErr.message);
    return {
      scanned: 0,
      needing_owned_filing: 0,
      created: 0,
      already_present: 0,
      failed: 0,
      skipped: 0,
      results: [],
    };
  }

  const rows = (caseRows ?? []) as Array<{
    id: string;
    user_id: string;
    intake: unknown;
    client_state: unknown;
    archived_at: string | null;
    payment_dispute_draft?: unknown;
  }>;

  let needingOwnedFiling = 0;
  let created = 0;
  let alreadyPresent = 0;
  let failed = 0;
  let skipped = 0;

  for (const row of rows) {
    const caseId = row.id?.trim() ?? "";
    const userId = row.user_id?.trim() ?? "";
    if (!caseId || !userId) {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: "skipped",
        reason: "invalid",
      });
      skipped += 1;
      continue;
    }

    if (row.archived_at?.trim()) {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: "skipped",
        reason: "archived",
      });
      skipped += 1;
      continue;
    }

    const filingKind = resolveRequiredOwnedFilingTaskKind(row.client_state);
    if (!filingKind) {
      continue;
    }

    needingOwnedFiling += 1;

    if (!isJusticeIntakePayload(row.intake)) {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: "skipped",
        filing_kind: filingKind,
        reason: "invalid",
      });
      skipped += 1;
      continue;
    }

    const ensured = await ensureOwnedFilingTaskAfterClientStateWrite(supabase, {
      userId,
      caseId,
      clientState: row.client_state,
      intake: row.intake as JusticeIntake,
      paymentDisputeDraft: row.payment_dispute_draft,
    });

    if (!ensured.ok) {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: "failed",
        filing_kind: ensured.kind,
        reason: "ensure_failed",
      });
      failed += 1;
      continue;
    }

    if (ensured.created) {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: "created",
        filing_kind: ensured.kind ?? filingKind,
      });
      created += 1;
    } else {
      results.push({
        case_id: caseId,
        user_id: userId,
        kind: "already_present",
        filing_kind: ensured.kind ?? filingKind,
      });
      alreadyPresent += 1;
    }
  }

  return {
    scanned: rows.length,
    needing_owned_filing: needingOwnedFiling,
    created,
    already_present: alreadyPresent,
    failed,
    skipped,
    results,
  };
}
