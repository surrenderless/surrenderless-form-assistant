import type { SupabaseClient } from "@supabase/supabase-js";
import { taskNotesMatchBbbFilingMarker } from "@/lib/justice/bbbFilingTask";
import {
  BBB_OWNED_FILING_DELIVERY_BLOCK_MARKER,
  bbbOwnedFilingTimelineId,
  bbbOwnedFilingIdempotencyKey,
  parseBbbOwnedFilingDeliveryRecord,
  upsertBbbOwnedFilingDeliveryNotes,
} from "@/lib/justice/bbbOwnedFilingDeliveryState";
import { BBB_OWNED_FILING_PROVIDER } from "@/lib/justice/bbbOwnedFilingDelivery";
import { taskNotesMatchFtcFilingMarker } from "@/lib/justice/ftcFilingTask";
import {
  FTC_OWNED_FILING_DELIVERY_BLOCK_MARKER,
  ftcOwnedFilingTimelineId,
  ftcOwnedFilingIdempotencyKey,
  parseFtcOwnedFilingDeliveryRecord,
  upsertFtcOwnedFilingDeliveryNotes,
} from "@/lib/justice/ftcOwnedFilingDeliveryState";
import { FTC_OWNED_FILING_PROVIDER } from "@/lib/justice/ftcOwnedFilingDelivery";
import {
  isOwnedFilingLiveCaseAllowlisted,
  isOwnedFilingSubmitArmed,
  parseOwnedFilingLiveCaseAllowlist,
} from "@/lib/justice/ownedFilingSubmitArmed";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import { appendCaseTimelineEntry } from "@/server/justiceTimelineAppend";

const TASK_SELECT =
  "id, user_id, case_id, title, due_date, notes, completed_at, created_at, updated_at" as const;

export type OwnedFilingKind = "bbb" | "ftc";

export type ClaimedOwnedFiling = {
  kind: OwnedFilingKind;
  userId: string;
  caseId: string;
  task: JusticeCaseTaskRow;
};

type OwnedDeliveryRecord = {
  delivery_state: "queued" | "submitting" | "failed" | "filed";
  provider: string;
  confirmation?: string;
  started_at?: string;
};

type ClaimDestination = {
  kind: OwnedFilingKind;
  deliveryMarker: string;
  provider: string;
  label: string;
  parseRecord: (notes: string | null | undefined) => OwnedDeliveryRecord | null;
  upsertNotes: (notes: string | null | undefined, record: OwnedDeliveryRecord) => string;
  timelineId: (caseId: string, state: "queued" | "submitting" | "failed" | "filed") => string;
  idempotencyKey: (caseId: string) => string;
  taskMarkerMatches: (notes: string | null | undefined, caseId: string) => boolean;
};

const DESTINATIONS: ClaimDestination[] = [
  {
    kind: "bbb",
    deliveryMarker: BBB_OWNED_FILING_DELIVERY_BLOCK_MARKER,
    provider: BBB_OWNED_FILING_PROVIDER,
    label: "BBB filing submitting",
    parseRecord: parseBbbOwnedFilingDeliveryRecord,
    upsertNotes: upsertBbbOwnedFilingDeliveryNotes,
    timelineId: bbbOwnedFilingTimelineId,
    idempotencyKey: bbbOwnedFilingIdempotencyKey,
    taskMarkerMatches: taskNotesMatchBbbFilingMarker,
  },
  {
    kind: "ftc",
    deliveryMarker: FTC_OWNED_FILING_DELIVERY_BLOCK_MARKER,
    provider: FTC_OWNED_FILING_PROVIDER,
    label: "FTC filing submitting",
    parseRecord: parseFtcOwnedFilingDeliveryRecord,
    upsertNotes: upsertFtcOwnedFilingDeliveryNotes,
    timelineId: ftcOwnedFilingTimelineId,
    idempotencyKey: ftcOwnedFilingIdempotencyKey,
    taskMarkerMatches: taskNotesMatchFtcFilingMarker,
  },
];

type QueuedCandidate = {
  cfg: ClaimDestination;
  task: JusticeCaseTaskRow;
  queuedAtMs: number;
};

async function listQueuedCandidates(
  supabase: SupabaseClient,
  cfg: ClaimDestination,
  candidateLimit: number
): Promise<QueuedCandidate[]> {
  const { data, error } = await supabase
    .from("justice_case_tasks")
    .select(TASK_SELECT)
    .is("completed_at", null)
    .like("notes", `%${cfg.deliveryMarker}%`)
    .limit(candidateLimit);
  if (error) {
    console.warn(`claim queued owned filing (${cfg.kind}): list candidates`, error.message);
    return [];
  }
  const rows = (data ?? []) as JusticeCaseTaskRow[];
  const candidates: QueuedCandidate[] = [];
  for (const task of rows) {
    const caseId = task.case_id?.trim() ?? "";
    if (!caseId || !task.user_id?.trim()) continue;
    if (!cfg.taskMarkerMatches(task.notes, caseId)) continue;
    const record = cfg.parseRecord(task.notes);
    if (record?.delivery_state !== "queued") continue;
    const queuedAtMs = record.started_at ? Date.parse(record.started_at) : NaN;
    candidates.push({
      cfg,
      task,
      queuedAtMs: Number.isFinite(queuedAtMs) ? queuedAtMs : 0,
    });
  }
  return candidates;
}

/**
 * Finds the oldest queued owned BBB/FTC filing task and atomically claims it by moving
 * `delivery_state: "queued" → "submitting"` with a compare-and-swap on the exact prior notes.
 * Parallel workers cannot both win the claim: the second CAS matches zero rows. Only "queued"
 * tasks are eligible — submitting/filed/failed/completed are never claimed.
 *
 * When OWNED_FILING_SUBMIT_ARMED is true, only case_ids in OWNED_FILING_LIVE_CASE_ALLOWLIST
 * are eligible. Empty/unset allowlist while armed → claim nothing (fail closed).
 * Unarmed callers (tests / non-worker) keep legacy claim behavior; the worker never claims unarmed.
 */
export async function findAndClaimNextQueuedOwnedFiling(
  supabase: SupabaseClient,
  options: { nowMs?: number; candidateLimit?: number; env?: Record<string, string | undefined> } = {}
): Promise<ClaimedOwnedFiling | null> {
  const nowMs = options.nowMs ?? Date.now();
  const candidateLimit = options.candidateLimit ?? 50;
  const env = options.env ?? process.env;

  // Armed live path: require an explicit non-empty per-case allowlist before scanning.
  if (isOwnedFilingSubmitArmed(env) && parseOwnedFilingLiveCaseAllowlist(env).size === 0) {
    return null;
  }

  const candidates: QueuedCandidate[] = [];
  for (const cfg of DESTINATIONS) {
    candidates.push(...(await listQueuedCandidates(supabase, cfg, candidateLimit)));
  }
  candidates.sort((a, b) => a.queuedAtMs - b.queuedAtMs);

  for (const candidate of candidates) {
    const { cfg, task } = candidate;
    const caseIdForGate = task.case_id?.trim() ?? "";
    if (
      isOwnedFilingSubmitArmed(env) &&
      !isOwnedFilingLiveCaseAllowlisted(caseIdForGate, env)
    ) {
      continue;
    }
    const priorNotes = task.notes ?? "";
    const claimedAt = new Date(nowMs).toISOString();
    const record = cfg.parseRecord(priorNotes);
    const submittingRecord: OwnedDeliveryRecord = {
      delivery_state: "submitting",
      provider: record?.provider || cfg.provider,
      started_at: claimedAt,
    };
    const submittingNotes = cfg.upsertNotes(priorNotes, submittingRecord);

    // Atomic compare-and-swap: only succeeds if no other worker has changed the notes.
    const { data, error } = await supabase
      .from("justice_case_tasks")
      .update({ notes: submittingNotes })
      .eq("id", task.id)
      .eq("notes", priorNotes)
      .is("completed_at", null)
      .select(TASK_SELECT)
      .maybeSingle();

    if (error) {
      console.warn(`claim queued owned filing (${cfg.kind}): claim update`, error.message);
      continue;
    }
    if (!data) {
      // Lost the race (another worker claimed it) — try the next candidate.
      continue;
    }

    const claimedTask = data as JusticeCaseTaskRow;
    const caseId = claimedTask.case_id.trim();
    await appendCaseTimelineEntry(supabase, claimedTask.user_id, caseId, {
      id: cfg.timelineId(caseId, "submitting"),
      type: "filing_recorded",
      label: cfg.label,
      detail: `provider: ${submittingRecord.provider}\nidempotency: ${cfg.idempotencyKey(caseId)}`,
      ts: claimedAt,
    });

    return {
      kind: cfg.kind,
      userId: claimedTask.user_id,
      caseId,
      task: claimedTask,
    };
  }

  return null;
}
