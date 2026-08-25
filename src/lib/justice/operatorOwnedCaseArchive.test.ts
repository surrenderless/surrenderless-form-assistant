import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  buildJusticeIntakeFromParts,
  defaultBuildJusticeIntakeParts,
} from "@/lib/justice/buildJusticeIntake";
import {
  OPERATOR_FURTHER_ESCALATION_OUTCOME_MARKER,
  OPERATOR_NO_RESOLUTION_OUTCOME_MARKER,
  OPERATOR_RESOLVED_OUTCOME_MARKER,
} from "@/lib/justice/completeFollowUpResponseReview";
import { followUpResponseReviewTaskNotesMarker } from "@/lib/justice/followUpResponseReviewTask";
import {
  detectOperatorOwnedClosableCase,
  hasOperatorTerminalResponseReviewOutcome,
  listOperatorClosableCases,
  shouldSuppressConsumerArchiveForOperatorOwnedClosure,
} from "@/lib/justice/operatorOwnedCaseArchive";
import { parseKeysetOrFilter } from "@/lib/justice/reconcilerKeysetPaginationTestSupport";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function terminalAction(
  outcomeNote: string,
  overrides: Partial<JusticeApprovedNextAction> = {}
): JusticeApprovedNextAction {
  return {
    label: "Small claims / demand letter",
    href: "/justice/demand-letter",
    status: "completed",
    completed_at: "2026-06-01T00:00:00.000Z",
    follow_up_needed: false,
    outcome_note: outcomeNote,
    handling_requested_at: "2026-06-01T00:00:00.000Z",
    handling_acknowledged_at: "2026-07-15T12:00:00.000Z",
    ...overrides,
  };
}

function completedReviewTask(): JusticeCaseTaskRow {
  return {
    id: "task-review",
    user_id: "user",
    case_id: CASE_ID,
    title: "Follow-up response review",
    due_date: null,
    notes: followUpResponseReviewTaskNotesMarker(CASE_ID),
    completed_at: "2026-07-15T12:00:00.000Z",
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-15T12:00:00.000Z",
  };
}

describe("operatorOwnedCaseArchive detection", () => {
  it("detects resolved and no_resolution markers", () => {
    expect(
      hasOperatorTerminalResponseReviewOutcome(
        terminalAction(OPERATOR_RESOLVED_OUTCOME_MARKER)
      )
    ).toBe(true);
    expect(
      hasOperatorTerminalResponseReviewOutcome(
        terminalAction(OPERATOR_NO_RESOLUTION_OUTCOME_MARKER)
      )
    ).toBe(true);
    expect(
      hasOperatorTerminalResponseReviewOutcome(
        terminalAction(OPERATOR_FURTHER_ESCALATION_OUTCOME_MARKER)
      )
    ).toBe(false);
  });

  it("allows closable detection only for terminal operator outcomes with ladder eligibility", () => {
    expect(
      detectOperatorOwnedClosableCase({
        caseId: CASE_ID,
        archivedAt: null,
        clientState: {
          prepared_packet_approved: true,
          approved_next_action: terminalAction(OPERATOR_RESOLVED_OUTCOME_MARKER),
        },
        tasks: [completedReviewTask()],
      })
    ).toBe(true);

    expect(
      detectOperatorOwnedClosableCase({
        caseId: CASE_ID,
        archivedAt: null,
        clientState: {
          prepared_packet_approved: true,
          approved_next_action: terminalAction(OPERATOR_NO_RESOLUTION_OUTCOME_MARKER),
        },
        tasks: [completedReviewTask()],
      })
    ).toBe(true);
  });

  it("never treats further escalation or open review as closable", () => {
    expect(
      detectOperatorOwnedClosableCase({
        caseId: CASE_ID,
        archivedAt: null,
        clientState: {
          prepared_packet_approved: true,
          approved_next_action: {
            label: "State AG",
            href: "/justice/state-ag",
            status: "approved",
            follow_up_needed: false,
          },
        },
        tasks: [completedReviewTask()],
      })
    ).toBe(false);

    const openReview: JusticeCaseTaskRow = {
      ...completedReviewTask(),
      completed_at: null,
    };
    expect(
      detectOperatorOwnedClosableCase({
        caseId: CASE_ID,
        archivedAt: null,
        clientState: {
          prepared_packet_approved: true,
          approved_next_action: terminalAction(OPERATOR_RESOLVED_OUTCOME_MARKER),
        },
        tasks: [openReview],
      })
    ).toBe(false);
  });

  it("suppresses consumer archive when operator owns closure", () => {
    expect(
      shouldSuppressConsumerArchiveForOperatorOwnedClosure({
        approved_next_action: terminalAction(OPERATOR_RESOLVED_OUTCOME_MARKER),
      })
    ).toBe(true);
    expect(
      shouldSuppressConsumerArchiveForOperatorOwnedClosure({
        approved_next_action: terminalAction("Awaiting responses."),
      })
    ).toBe(false);
  });
});

type MockCaseRow = {
  id: string;
  user_id: string;
  intake: unknown;
  client_state: unknown;
  archived_at: string | null;
};

function minimalIntake(companyName: string) {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: companyName,
    purchase_or_signup: "widget order",
    consumer_us_state: "CA",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    story: "Ordered a widget that never arrived and merchant refused a refund.",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-01-15",
    merchant_response_type: "refused_help",
    contact_proof_type: "paste",
    contact_proof_text: "Refused refund by email.",
  });
}

function reviewTaskRow(caseId: string, id: string, updatedAt: string): JusticeCaseTaskRow {
  return {
    id,
    user_id: "user-1",
    case_id: caseId,
    title: "Follow-up response review",
    due_date: null,
    notes: followUpResponseReviewTaskNotesMarker(caseId),
    completed_at: updatedAt,
    created_at: updatedAt,
    updated_at: updatedAt,
  };
}

function closableCaseRow(
  caseId: string,
  outcomeNote: string,
  archivedAt: string | null = null
): MockCaseRow {
  return {
    id: caseId,
    user_id: "user-1",
    intake: minimalIntake(`Company ${caseId.slice(-4)}`),
    client_state: {
      prepared_packet_approved: true,
      approved_next_action: terminalAction(outcomeNote),
    },
    archived_at: archivedAt,
  };
}

/**
 * Mocks only the exact Supabase chain shapes `listOperatorClosableCases` issues:
 * - `justice_case_tasks`: the keyset-paginated review-task scan (`.like().not()` +
 *   `applyKeysetCursor`'s `.or().order().order()` + `.limit()`), and the flat per-page
 *   "all tasks for these case ids" lookup (`.in("case_id", ids)`).
 * - `justice_cases`: `.in("id", ids).is("archived_at", null)`.
 */
type MockErrors = {
  /** Errors every keyset task-page fetch, or (if a number) only that 1-indexed page. */
  tasksError?: boolean | number;
  casesError?: boolean;
  allTasksError?: boolean;
};

function makeSupabase(
  tasks: JusticeCaseTaskRow[],
  cases: MockCaseRow[],
  options?: { counters?: { keysetPageFetches: number }; errors?: MockErrors }
): SupabaseClient {
  const counters = options?.counters;
  const errors = options?.errors ?? {};
  let taskPageCallCount = 0;
  return {
    from(table: string) {
      if (table === "justice_case_tasks") {
        return {
          select() {
            const b: Record<string, unknown> = {};
            let likePattern: string | null = null;
            let completedNotNull = false;
            let inCaseIds: string[] | null = null;
            let cursor: { updatedAt: string; id: string } | null = null;
            let limitN: number | null = null;
            // Tracks every `.order(col, { ascending })` call in the order they're chained, so
            // this mock can faithfully replay either the pre-fix single `updated_at DESC` order
            // or the fix's chained `updated_at ASC, id ASC` keyset order — a hardcoded ascending
            // sort here would silently pass regardless of which direction production actually
            // requested.
            const orderSpecs: Array<{ col: "updated_at" | "id"; ascending: boolean }> = [];
            b.like = (_col: string, pat: string) => {
              likePattern = pat;
              return b;
            };
            b.not = (col: string, op: string, val: unknown) => {
              if (col === "completed_at" && op === "is" && val === null) completedNotNull = true;
              return b;
            };
            b.in = (col: string, ids: string[]) => {
              if (col === "case_id") inCaseIds = ids;
              return b;
            };
            b.or = (filter: string) => {
              cursor = parseKeysetOrFilter(filter);
              return b;
            };
            b.order = (col: "updated_at" | "id", opts: { ascending: boolean }) => {
              orderSpecs.push({ col, ascending: opts.ascending });
              return b;
            };
            b.limit = (n: number) => {
              limitN = n;
              return b;
            };
            b.then = (resolve: (v: unknown) => unknown) => {
              if (inCaseIds) {
                if (errors.allTasksError) {
                  return Promise.resolve({
                    data: null,
                    error: { message: "case tasks down" },
                  }).then(resolve);
                }
                const ids = inCaseIds;
                const matched = tasks.filter((t) => ids.includes(t.case_id));
                return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null }).then(
                  resolve
                );
              }

              if (counters) counters.keysetPageFetches += 1;
              taskPageCallCount += 1;
              const shouldErrorThisPage =
                errors.tasksError === true ||
                (typeof errors.tasksError === "number" && errors.tasksError === taskPageCallCount);
              if (shouldErrorThisPage) {
                return Promise.resolve({ data: null, error: { message: "tasks down" } }).then(
                  resolve
                );
              }
              const marker = (likePattern ?? "").replace(/%/g, "");
              let matched = tasks.filter(
                (t) =>
                  (!completedNotNull || Boolean(t.completed_at?.trim())) &&
                  (marker ? (t.notes ?? "").includes(marker) : true) &&
                  (!cursor ||
                    t.updated_at > cursor.updatedAt ||
                    (t.updated_at === cursor.updatedAt && t.id > cursor.id))
              );
              matched = [...matched].sort((a, b2) => {
                for (const spec of orderSpecs.length > 0 ? orderSpecs : [{ col: "updated_at" as const, ascending: true }]) {
                  const av = a[spec.col];
                  const bv = b2[spec.col];
                  if (av === bv) continue;
                  const cmp = av < bv ? -1 : 1;
                  return spec.ascending ? cmp : -cmp;
                }
                return 0;
              });
              if (limitN != null) matched = matched.slice(0, limitN);
              return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null }).then(
                resolve
              );
            };
            return b;
          },
        };
      }
      if (table === "justice_cases") {
        return {
          select() {
            const b: Record<string, unknown> = {};
            let inIds: string[] | null = null;
            let archivedNull = false;
            b.in = (col: string, ids: string[]) => {
              if (col === "id") inIds = ids;
              return b;
            };
            b.is = (col: string, val: unknown) => {
              if (col === "archived_at" && val === null) archivedNull = true;
              return b;
            };
            b.then = (resolve: (v: unknown) => unknown) => {
              if (errors.casesError) {
                return Promise.resolve({ data: null, error: { message: "cases down" } }).then(
                  resolve
                );
              }
              const matched = cases.filter(
                (c) => (!inIds || inIds.includes(c.id)) && (!archivedNull || !c.archived_at)
              );
              return Promise.resolve({ data: matched.map((r) => ({ ...r })), error: null }).then(
                resolve
              );
            };
            return b;
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("listOperatorClosableCases pagination", () => {
  const ARCHIVED_CASE_ID = "aaaaaaaa-0000-4000-8000-000000000001";
  const INELIGIBLE_CASE_1 = "aaaaaaaa-0000-4000-8000-000000000002";
  const INELIGIBLE_CASE_2 = "aaaaaaaa-0000-4000-8000-000000000003";
  const CLOSABLE_CASE_ID = "aaaaaaaa-0000-4000-8000-000000000004";

  it("finds an older closable case behind a full page of newer archived/ineligible tasks (true regression: the pre-fix query ordered updated_at DESC, so a single 3-row page would have returned only the three newer tasks and permanently missed this one)", async () => {
    // limit: 1 => pageSize = limit * 3 = 3. The closable case's review task is the OLDEST of
    // the four; three strictly NEWER tasks (archived, then two non-terminal outcomes) exist
    // ahead of it. This mirrors the pre-fix implementation's actual query shape
    // (`order("updated_at", { ascending: false }).limit(150)`) at 1/50th scale: sorted newest
    // first, a single page of size 3 would contain only the three newer tasks and never reach
    // the older closable one. Verified directly — see the git-stash check in the PR notes.
    const tasks: JusticeCaseTaskRow[] = [
      reviewTaskRow(CLOSABLE_CASE_ID, "task-old", "2026-06-01T00:00:00.000Z"),
      reviewTaskRow(ARCHIVED_CASE_ID, "task-new-1", "2026-07-01T00:00:00.000Z"),
      reviewTaskRow(INELIGIBLE_CASE_1, "task-new-2", "2026-07-02T00:00:00.000Z"),
      reviewTaskRow(INELIGIBLE_CASE_2, "task-new-3", "2026-07-03T00:00:00.000Z"),
    ];
    const cases: MockCaseRow[] = [
      closableCaseRow(CLOSABLE_CASE_ID, OPERATOR_RESOLVED_OUTCOME_MARKER),
      closableCaseRow(ARCHIVED_CASE_ID, OPERATOR_RESOLVED_OUTCOME_MARKER, "2026-07-05T00:00:00.000Z"),
      closableCaseRow(INELIGIBLE_CASE_1, "Awaiting responses."),
      closableCaseRow(INELIGIBLE_CASE_2, OPERATOR_FURTHER_ESCALATION_OUTCOME_MARKER),
    ];

    const supabase = makeSupabase(tasks, cases);
    const items = await listOperatorClosableCases(supabase, { limit: 1 });

    expect(items).toHaveLength(1);
    expect(items[0]?.case_id).toBe(CLOSABLE_CASE_ID);
    expect(items[0]?.outcome).toBe("resolved");
  });

  it("advances the keyset cursor correctly when review-task updated_at values tie", async () => {
    // All four tasks share the exact same updated_at — id is the only tiebreaker. With
    // pageSize = 3, the first page exhausts three tied, ineligible cases and must resume
    // exactly where it left off (same timestamp, id > "tie-task-c") rather than looping on the
    // same tied group or skipping the fourth, closable one.
    const TIE_TS = "2026-07-10T00:00:00.000Z";
    const TIE_CASE_A = "bbbbbbbb-0000-4000-8000-000000000001";
    const TIE_CASE_B = "bbbbbbbb-0000-4000-8000-000000000002";
    const TIE_CASE_C = "bbbbbbbb-0000-4000-8000-000000000003";
    const TIE_CLOSABLE_CASE = "bbbbbbbb-0000-4000-8000-000000000004";

    const tasks: JusticeCaseTaskRow[] = [
      reviewTaskRow(TIE_CASE_A, "tie-task-a", TIE_TS),
      reviewTaskRow(TIE_CASE_B, "tie-task-b", TIE_TS),
      reviewTaskRow(TIE_CASE_C, "tie-task-c", TIE_TS),
      reviewTaskRow(TIE_CLOSABLE_CASE, "tie-task-d", TIE_TS),
    ];
    const cases: MockCaseRow[] = [
      closableCaseRow(TIE_CASE_A, "Awaiting responses."),
      closableCaseRow(TIE_CASE_B, "Awaiting responses."),
      closableCaseRow(TIE_CASE_C, "Awaiting responses."),
      closableCaseRow(TIE_CLOSABLE_CASE, OPERATOR_NO_RESOLUTION_OUTCOME_MARKER),
    ];

    const supabase = makeSupabase(tasks, cases);
    const items = await listOperatorClosableCases(supabase, { limit: 1 });

    expect(items).toHaveLength(1);
    expect(items[0]?.case_id).toBe(TIE_CLOSABLE_CASE);
    expect(items[0]?.outcome).toBe("no_resolution");
  });

  it("stops once the requested limit of closable cases is found, without fetching a further page", async () => {
    // limit: 1 => pageSize = 3. The closable case is found while still processing page 1 (which
    // is full — 3 tasks — so pagination alone wouldn't have stopped here); only the early
    // `items.length >= limit` return should prevent a second page fetch. A counter on the
    // keyset task query proves that fetch never happens, independent of ordering.
    const CLOSABLE_ID = "cccccccc-0000-4000-8000-000000000001";
    const INELIGIBLE_1 = "cccccccc-0000-4000-8000-000000000002";
    const INELIGIBLE_2 = "cccccccc-0000-4000-8000-000000000003";
    const NEVER_REACHED = "cccccccc-0000-4000-8000-000000000004";

    const tasks: JusticeCaseTaskRow[] = [
      reviewTaskRow(CLOSABLE_ID, "task-1", "2026-07-01T00:00:00.000Z"),
      reviewTaskRow(INELIGIBLE_1, "task-2", "2026-07-02T00:00:00.000Z"),
      reviewTaskRow(INELIGIBLE_2, "task-3", "2026-07-03T00:00:00.000Z"),
      // Strictly beyond page 1 (pageSize = 3) — must never be fetched.
      reviewTaskRow(NEVER_REACHED, "task-4", "2026-07-04T00:00:00.000Z"),
    ];
    const cases: MockCaseRow[] = [
      closableCaseRow(CLOSABLE_ID, OPERATOR_RESOLVED_OUTCOME_MARKER),
      closableCaseRow(INELIGIBLE_1, "Awaiting responses."),
      closableCaseRow(INELIGIBLE_2, OPERATOR_FURTHER_ESCALATION_OUTCOME_MARKER),
      closableCaseRow(NEVER_REACHED, OPERATOR_RESOLVED_OUTCOME_MARKER),
    ];

    const counters = { keysetPageFetches: 0 };
    const supabase = makeSupabase(tasks, cases, { counters });
    const items = await listOperatorClosableCases(supabase, { limit: 1 });

    expect(items).toHaveLength(1);
    expect(items[0]?.case_id).toBe(CLOSABLE_ID);
    expect(counters.keysetPageFetches).toBe(1);
  });

  it("returns closable cases newest-review-task-first, matching the pre-fix presentation order (when nothing is excluded)", async () => {
    // With candidates <= limit, nothing is excluded by selection, so this isolates the
    // presentation re-sort alone: the scan walks oldest-first (see function doc), but the
    // returned array is newest-first, matching the old `updated_at DESC` query's visual style.
    // See the next test for what happens — and what does NOT stay the same — once candidates
    // exceed `limit` and selection itself comes into play.
    const OLDEST = "eeeeeeee-0000-4000-8000-000000000001";
    const MIDDLE = "eeeeeeee-0000-4000-8000-000000000002";
    const NEWEST = "eeeeeeee-0000-4000-8000-000000000003";

    const tasks: JusticeCaseTaskRow[] = [
      reviewTaskRow(OLDEST, "task-1", "2026-07-01T00:00:00.000Z"),
      reviewTaskRow(MIDDLE, "task-2", "2026-07-02T00:00:00.000Z"),
      reviewTaskRow(NEWEST, "task-3", "2026-07-03T00:00:00.000Z"),
    ];
    const cases: MockCaseRow[] = [
      closableCaseRow(OLDEST, OPERATOR_RESOLVED_OUTCOME_MARKER),
      closableCaseRow(MIDDLE, OPERATOR_NO_RESOLUTION_OUTCOME_MARKER),
      closableCaseRow(NEWEST, OPERATOR_RESOLVED_OUTCOME_MARKER),
    ];

    const supabase = makeSupabase(tasks, cases);
    const items = await listOperatorClosableCases(supabase, { limit: 10 });

    expect(items.map((i) => i.case_id)).toEqual([NEWEST, MIDDLE, OLDEST]);
  });

  it("selects the oldest eligible cases when candidates exceed limit, then presents that selected batch newest-first", async () => {
    // Five closable cases, one review task each, strictly increasing updated_at (oldest to
    // newest) and no junk needed — the point here is selection bias, not page traversal. With
    // limit: 3, the fairness-preserving behavior is to select the THREE OLDEST candidates
    // (T1, T2, T3), not the three newest (T3, T4, T5) the pre-fix `updated_at DESC` window
    // would have favored — proving selection priority genuinely changed, not just cosmetics.
    // The already-selected batch is still presented newest-first within itself: [T3, T2, T1].
    const T1 = "aaaaaaab-0000-4000-8000-000000000001";
    const T2 = "aaaaaaab-0000-4000-8000-000000000002";
    const T3 = "aaaaaaab-0000-4000-8000-000000000003";
    const T4 = "aaaaaaab-0000-4000-8000-000000000004";
    const T5 = "aaaaaaab-0000-4000-8000-000000000005";

    const tasks: JusticeCaseTaskRow[] = [
      reviewTaskRow(T1, "task-1", "2026-07-01T00:00:00.000Z"),
      reviewTaskRow(T2, "task-2", "2026-07-02T00:00:00.000Z"),
      reviewTaskRow(T3, "task-3", "2026-07-03T00:00:00.000Z"),
      reviewTaskRow(T4, "task-4", "2026-07-04T00:00:00.000Z"),
      reviewTaskRow(T5, "task-5", "2026-07-05T00:00:00.000Z"),
    ];
    const cases: MockCaseRow[] = [
      closableCaseRow(T1, OPERATOR_RESOLVED_OUTCOME_MARKER),
      closableCaseRow(T2, OPERATOR_RESOLVED_OUTCOME_MARKER),
      closableCaseRow(T3, OPERATOR_RESOLVED_OUTCOME_MARKER),
      closableCaseRow(T4, OPERATOR_RESOLVED_OUTCOME_MARKER),
      closableCaseRow(T5, OPERATOR_RESOLVED_OUTCOME_MARKER),
    ];

    const supabase = makeSupabase(tasks, cases);
    const items = await listOperatorClosableCases(supabase, { limit: 3 });

    // Selected set is the three OLDEST (T1-T3), not the three newest (T3-T5).
    expect(items.map((i) => i.case_id)).toEqual([T3, T2, T1]);
  });

  it("fails closed (returns []) and discards already-collected items when the review-task query errors on a later page", async () => {
    // limit: 2 => pageSize = 6. Page 1 is exactly full (6 tasks, so pagination alone would
    // continue to page 2 regardless of the error) and yields exactly one closable case — not
    // enough to satisfy limit: 2, so the scan must attempt a page 2 fetch. That fetch is
    // configured to fail on its 2nd call specifically (not the 1st), so page 1's genuine
    // success is proven, not just an immediate error. The pre-fix implementation had no way to
    // return a partial result at all — every error path returned [] before anything was
    // collected — so this must too, rather than silently handing back the page-1 finding as if
    // it were a complete scan.
    const CLOSABLE_ON_PAGE_1 = "ffffffff-0000-4000-8000-000000000001";
    const PADDING = ["2", "3", "4", "5", "6"].map(
      (n) => `ffffffff-0000-4000-8000-00000000000${n}`
    );
    const ON_PAGE_2 = "ffffffff-0000-4000-8000-000000000007";

    const tasks: JusticeCaseTaskRow[] = [
      reviewTaskRow(CLOSABLE_ON_PAGE_1, "task-1", "2026-07-01T00:00:00.000Z"),
      ...PADDING.map((id, i) =>
        reviewTaskRow(id, `task-${i + 2}`, `2026-07-0${i + 2}T00:00:00.000Z`)
      ),
      // Strictly beyond page 1 (pageSize = 6) — the page-2 fetch that reaches for this errors.
      reviewTaskRow(ON_PAGE_2, "task-7", "2026-07-07T00:00:00.000Z"),
    ];
    const cases: MockCaseRow[] = [
      closableCaseRow(CLOSABLE_ON_PAGE_1, OPERATOR_RESOLVED_OUTCOME_MARKER),
      ...PADDING.map((id) => closableCaseRow(id, "Awaiting responses.")),
    ];

    const supabase = makeSupabase(tasks, cases, { errors: { tasksError: 2 } });
    const items = await listOperatorClosableCases(supabase, { limit: 2 });

    expect(items).toEqual([]);
  });

  it("fails closed (returns []) when the cases lookup errors, discarding items already collected on this page", async () => {
    const tasks: JusticeCaseTaskRow[] = [
      reviewTaskRow(CLOSABLE_CASE_ID, "task-1", "2026-07-01T00:00:00.000Z"),
    ];
    const cases: MockCaseRow[] = [closableCaseRow(CLOSABLE_CASE_ID, OPERATOR_RESOLVED_OUTCOME_MARKER)];

    const supabase = makeSupabase(tasks, cases, { errors: { casesError: true } });
    const items = await listOperatorClosableCases(supabase, { limit: 1 });
    expect(items).toEqual([]);
  });

  it("fails closed (returns []) when the per-case full-task lookup errors", async () => {
    const tasks: JusticeCaseTaskRow[] = [
      reviewTaskRow(CLOSABLE_CASE_ID, "task-1", "2026-07-01T00:00:00.000Z"),
    ];
    const cases: MockCaseRow[] = [closableCaseRow(CLOSABLE_CASE_ID, OPERATOR_RESOLVED_OUTCOME_MARKER)];

    const supabase = makeSupabase(tasks, cases, { errors: { allTasksError: true } });
    const items = await listOperatorClosableCases(supabase, { limit: 1 });
    expect(items).toEqual([]);
  });

  it("returns [] for a non-positive limit without querying anything (guards pageSize === 0 / negative)", async () => {
    let queried = false;
    const tasks: JusticeCaseTaskRow[] = [
      reviewTaskRow(CLOSABLE_CASE_ID, "task-1", "2026-07-01T00:00:00.000Z"),
    ];
    const cases: MockCaseRow[] = [closableCaseRow(CLOSABLE_CASE_ID, OPERATOR_RESOLVED_OUTCOME_MARKER)];
    const supabase = new Proxy(makeSupabase(tasks, cases), {
      get(target, prop, receiver) {
        if (prop === "from") queried = true;
        return Reflect.get(target, prop, receiver);
      },
    });

    await expect(listOperatorClosableCases(supabase, { limit: 0 })).resolves.toEqual([]);
    await expect(listOperatorClosableCases(supabase, { limit: -5 })).resolves.toEqual([]);
    await expect(listOperatorClosableCases(supabase, { limit: NaN })).resolves.toEqual([]);
    expect(queried).toBe(false);
  });
});
