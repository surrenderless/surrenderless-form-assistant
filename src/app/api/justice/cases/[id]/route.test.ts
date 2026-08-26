import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  buildJusticeIntakeFromParts,
  defaultBuildJusticeIntakeParts,
} from "@/lib/justice/buildJusticeIntake";
import {
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
  MERCHANT_RESOLVED_TERMINAL_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import { CHAT_INLINE_PACKET_FALLBACK_PREP_HREF } from "@/lib/justice/chatInlineApprovedPrep";

const mockCaseSelectMaybeSingle = vi.fn();
const mockCaseUpdateMaybeSingle = vi.fn();
/** Captures the actual payload passed to justice_cases.update(...) — asserting only
 * mockCaseUpdateMaybeSingle's preconfigured return value proves nothing about what the route
 * really sent to Supabase, since that return value is test-authored fiction either way. */
const mockCaseUpdatePatch = vi.fn();
const mockTasksSelect = vi.fn();
const mockFilingsSelect = vi.fn();

type FollowUpTaskRow = {
  id: string;
  user_id: string;
  case_id: string;
  title: string;
  due_date: string | null;
  notes: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};
/** Backs the real (unmocked) completeFollowUpCaseTaskIfOwnedByAction's own supabase queries —
 * separate from mockTasksSelect, which backs the unrelated "all tasks for escalation validation"
 * fetch. Reset per test so seeded rows don't leak across cases. */
let followUpTasksStore: FollowUpTaskRow[] = [];

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

vi.mock("@/lib/justice/bbbOwnedFilingSubmitContext", () => ({
  buildBbbOwnedFilingSubmitContextFromRequest: vi.fn(() => ({})),
  runWithBbbOwnedFilingSubmitContext: vi.fn((_ctx: unknown, fn: () => unknown) => fn()),
}));

vi.mock("@/lib/justice/ensureFollowUpAfterOperatorClientStateWrite", () => ({
  ensureFollowUpAfterOperatorClientStateWrite: vi.fn(async () => ({
    ok: true,
    timeline: null,
    created: false,
    task: null,
  })),
  FOLLOW_UP_TASK_ENSURE_RETRYABLE_ERROR:
    "Case updated but follow-up task could not be created. Retry to finish follow-up handoff.",
}));

vi.mock("@/lib/justice/ensureOwnedFilingTaskAfterClientStateWrite", () => ({
  ensureOwnedFilingTaskAfterClientStateWrite: vi.fn(),
  OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR:
    "Case updated but the next operator filing task could not be created. Retry to finish handoff.",
}));

vi.mock("@/lib/justice/merchantContactEmailDelivery", () => ({
  attemptAutomatedMerchantContactEmailDelivery: vi.fn(async () => ({ status: "skipped" })),
}));

vi.mock("@/lib/justice/paymentDisputeEmailDelivery", () => ({
  attemptAutomatedPaymentDisputeEmailDelivery: vi.fn(async () => ({ status: "skipped" })),
}));

vi.mock("@/lib/justice/demandLetterEmailDelivery", () => ({
  attemptAutomatedDemandLetterEmailDeliveryAfterEnsure: vi.fn(async () => ({
    timeline: null,
    result: { status: "skipped" },
  })),
}));

vi.mock("@/lib/justice/bbbOwnedFilingDelivery", () => ({
  attemptAutomatedBbbFilingAfterEnsure: vi.fn(async () => ({
    timeline: null,
    result: { status: "skipped" },
  })),
  maybeAttemptAutomatedBbbFilingForClientState: vi.fn(async () => ({
    timeline: null,
    result: { status: "skipped" },
  })),
}));

vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: vi.fn(async () => null),
}));

vi.mock("@/lib/justice/handlingRequestTask", () => ({
  ensureHandlingRequestTask: vi.fn(async () => ({ timeline: null, created: false, task: null })),
}));

// Only completeMerchantContactFilingTaskIfOpen is mocked (route wiring is what's under test in
// this file — the real reconciliation mechanics, open-task-completes vs. already-completed-is-a-
// no-op, are proven directly against the real, unmocked function in merchantContactFilingTask.test.ts).
// Everything else from this module (shouldQueueMerchantContactFilingTask, etc., used by
// rejectMerchantContactApprovalWithoutRecipient and other real code paths this file exercises)
// passes through unmocked via importOriginal.
vi.mock("@/lib/justice/merchantContactFilingTask", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/justice/merchantContactFilingTask")>();
  return {
    ...actual,
    completeMerchantContactFilingTaskIfOpen: vi.fn(async () => ({
      task: null,
      timeline: null,
      completed: false,
    })),
  };
});

// Not mocked — completeFollowUpCaseTaskIfOwnedByAction runs for real against the fake supabase
// below (via followUpTasksStore), so the route's actual row-scoping is what's under test here,
// not a stand-in.

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      if (table === "justice_cases") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: mockCaseSelectMaybeSingle,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            mockCaseUpdatePatch(patch);
            return {
              eq: () => ({
                eq: () => ({
                  eq: () => ({
                    select: () => ({
                      maybeSingle: mockCaseUpdateMaybeSingle,
                    }),
                  }),
                  select: () => ({
                    maybeSingle: mockCaseUpdateMaybeSingle,
                  }),
                }),
              }),
            };
          },
        };
      }
      if (table === "justice_case_tasks") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => {
                const plain = mockTasksSelect();
                return {
                  // Preserves the existing "await select().eq().eq()" callers (escalation
                  // validation) exactly as before...
                  then: (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) =>
                    Promise.resolve(plain).then(onF, onR),
                  // ...while also supporting completeFollowUpCaseTaskIfOwnedByAction's real
                  // .like().is().limit() scan over the seeded follow-up rows.
                  like: () => ({
                    is: () => ({
                      limit: async () => ({
                        data: followUpTasksStore.filter((t) => !t.completed_at?.trim()),
                        error: null,
                      }),
                    }),
                  }),
                };
              },
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            const filters: Record<string, string> = {};
            const builder = {
              eq: (col: string, val: string) => {
                filters[col] = val;
                return builder;
              },
              select: () => ({
                maybeSingle: async () => {
                  const row = followUpTasksStore.find(
                    (t) => t.id === filters.id && t.user_id === filters.user_id
                  );
                  if (!row) return { data: null, error: null };
                  if (typeof patch.completed_at === "string") {
                    row.completed_at = patch.completed_at;
                  }
                  return { data: { ...row }, error: null };
                },
              }),
            };
            return builder;
          },
        };
      }
      if (table === "justice_case_filings") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => mockFilingsSelect(),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  })),
}));

import { PATCH } from "@/app/api/justice/cases/[id]/route";
import { getUserOr401 } from "@/server/requireUser";
import {
  ensureOwnedFilingTaskAfterClientStateWrite,
  OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR,
} from "@/lib/justice/ensureOwnedFilingTaskAfterClientStateWrite";
import { attemptAutomatedMerchantContactEmailDelivery } from "@/lib/justice/merchantContactEmailDelivery";
import { attemptAutomatedPaymentDisputeEmailDelivery } from "@/lib/justice/paymentDisputeEmailDelivery";
import { attemptAutomatedDemandLetterEmailDeliveryAfterEnsure } from "@/lib/justice/demandLetterEmailDelivery";
import { completeMerchantContactFilingTaskIfOpen } from "@/lib/justice/merchantContactFilingTask";

const USER_ID = "user_test_123";
const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const intake = buildJusticeIntakeFromParts({
  ...defaultBuildJusticeIntakeParts(),
  problem_category: "online_purchase",
  company_name: "Acme Retail",
  purchase_or_signup: "widget",
  story: "Never arrived.",
  money_amount: "$50.00",
  already_contacted: "yes",
  contact_method: "email",
  contact_date: "2026-01-15",
  merchant_response_type: "refused_help",
  user_display_name: "Jordan Lee",
  reply_email: "e2e@example.com",
  consumer_us_state: "CA",
  company_contact_email: "support@acme.example",
});

const merchantClientState = {
  prepared_packet_approved: true,
  approved_next_action: {
    label: "Merchant contact",
    href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
    status: "approved",
  },
};

const demandLetterClientState = {
  prepared_packet_approved: true,
  approved_next_action: {
    label: "Small claims / demand letter",
    href: "/justice/demand-letter",
    status: "approved",
  },
};

const merchantResolvedTerminalClientState = {
  prepared_packet_approved: true,
  approved_next_action: {
    label: "Merchant issue resolved",
    href: MERCHANT_RESOLVED_TERMINAL_HREF,
    status: "completed" as const,
    approved_at: "2026-01-01T00:00:00.000Z",
    completed_at: "2026-01-01T00:00:00.000Z",
  },
};

/**
 * The real pre-existing state when a consumer's intake already says
 * already_contacted: "yes" + merchant_response_type: "resolved" at the moment the packet is
 * first approved. pickPreparedNextAction (used by the client's own approve handler, not
 * recomputeApprovedNextActionAfterIntake) does not special-case isMerchantResolved — it downgrades
 * every escalation destination to "later" and lands on the generic CHAT_INLINE_PACKET_FALLBACK_PREP_HREF
 * "approved" fallback. The chat-ai autopilot effect (shouldAutopilotMerchantContactDocumentation)
 * then immediately re-derives via recomputeApprovedNextActionAfterIntake with this fallback action
 * as `existing` and PATCHes the terminal action over it — this is the realistic "before" state for
 * that second PATCH, not an empty client_state.
 *
 * already_contacted was "yes" from the original intake, before packet approval, so
 * pickPreparedNextAction never recommended MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF and
 * shouldQueueMerchantContactFilingTask (gated on that exact href) never fired — no owned
 * merchant-contact task or filing was ever queued for this case. Asserted directly below via
 * empty tasks/filings mocks.
 */
const fallbackApprovedClientState = {
  prepared_packet_approved: true,
  approved_next_action: {
    label: "Review packet",
    href: CHAT_INLINE_PACKET_FALLBACK_PREP_HREF,
    status: "approved",
  },
};

function buildPatchRequest(body: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/justice/cases/${CASE_ID}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function routeContext() {
  return { params: Promise.resolve({ id: CASE_ID }) };
}

describe("PATCH /api/justice/cases/[id] owned filing ensure", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
    followUpTasksStore = [];
    mockCaseSelectMaybeSingle.mockResolvedValue({
      // Paid so this describe block's first-approval-transition patches (merchantClientState)
      // exercise owned-filing-ensure behavior, not the separate payment gate (covered on its own
      // in rejectUnpaidPreparedPacketApprovalPatch.test.ts and the "payment gating" block below).
      data: { client_state: {}, archived_at: null, paid_at: "2026-01-01T00:00:00.000Z", intake },
      error: null,
    });
    mockTasksSelect.mockResolvedValue({ data: [], error: null });
    mockFilingsSelect.mockResolvedValue({ data: [], error: null });
    mockCaseUpdateMaybeSingle.mockResolvedValue({
      data: {
        id: CASE_ID,
        intake,
        timeline: [],
        payment_dispute_draft: null,
        client_state: merchantClientState,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        archived_at: null,
        case_label: null,
        paid_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    });
    vi.mocked(ensureOwnedFilingTaskAfterClientStateWrite).mockResolvedValue({
      ok: true,
      kind: "merchant_contact",
      timeline: null,
      created: true,
      task: {
        id: "task-1",
        user_id: USER_ID,
        case_id: CASE_ID,
        title: "Merchant contact",
        due_date: null,
        notes: "merchant_contact:",
        completed_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns 200 after successful owned filing ensure and preserves merchant delivery", async () => {
    const res = await PATCH(buildPatchRequest({ client_state: merchantClientState }), routeContext());

    expect(res.status).toBe(200);
    expect(ensureOwnedFilingTaskAfterClientStateWrite).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: USER_ID,
        caseId: CASE_ID,
        clientState: merchantClientState,
        attemptDemandLetterEmail: false,
        attemptPaymentDisputeEmail: false,
      })
    );
    expect(attemptAutomatedMerchantContactEmailDelivery).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      CASE_ID
    );
    expect(attemptAutomatedPaymentDisputeEmailDelivery).not.toHaveBeenCalled();
    expect(attemptAutomatedDemandLetterEmailDeliveryAfterEnsure).not.toHaveBeenCalled();
  });

  it("returns 409 when the case was written concurrently between the pre-patch read and this write (e.g. by an operator completing a filing)", async () => {
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: {
        client_state: {},
        archived_at: null,
        updated_at: "2026-01-01T00:00:00.000Z",
        paid_at: "2026-01-01T00:00:00.000Z",
        intake,
      },
      error: null,
    });
    // A CAS-guarded update matching zero rows is exactly what a concurrent writer having
    // already changed updated_at looks like from PostgREST's perspective.
    mockCaseUpdateMaybeSingle.mockResolvedValue({ data: null, error: null });

    const res = await PATCH(buildPatchRequest({ client_state: merchantClientState }), routeContext());

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/updated concurrently/i);
    expect(ensureOwnedFilingTaskAfterClientStateWrite).not.toHaveBeenCalled();
  });

  it("returns 500 with OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR when ensure fails", async () => {
    vi.mocked(ensureOwnedFilingTaskAfterClientStateWrite).mockResolvedValue({
      ok: false,
      error: OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR,
      kind: "merchant_contact",
      timeline: null,
      created: false,
      task: null,
    });

    const res = await PATCH(buildPatchRequest({ client_state: merchantClientState }), routeContext());

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: OWNED_FILING_TASK_ENSURE_RETRYABLE_ERROR });
    expect(attemptAutomatedMerchantContactEmailDelivery).not.toHaveBeenCalled();
    expect(attemptAutomatedPaymentDisputeEmailDelivery).not.toHaveBeenCalled();
    expect(attemptAutomatedDemandLetterEmailDeliveryAfterEnsure).not.toHaveBeenCalled();
  });

  it("permits the realistic transition from the generic packet-approved fallback (no owned merchant-contact task or filing ever queued for this case) to the merchant-resolved terminal action, and writes it in the actual Supabase update payload", async () => {
    // Realistic pre-existing state: the fallback action pickPreparedNextAction lands on when
    // already_contacted/merchant_response_type already say "resolved" at packet-approval time
    // (see fallbackApprovedClientState doc comment) — not an empty/fresh client_state, and not
    // MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF (which would route through the
    // owned-step reject-gates below).
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: {
        client_state: fallbackApprovedClientState,
        archived_at: null,
        updated_at: "2026-01-01T00:00:00.000Z",
        paid_at: "2026-01-01T00:00:00.000Z",
        intake,
      },
      error: null,
    });
    // No owned merchant-contact task or filing exists for this case — asserted as an input here,
    // proven as an invariant (not just a convenient mock) by the doc comment above and by
    // shouldQueueMerchantContactFilingTask's href gate in ensureOwnedFilingTaskAfterClientStateWrite.test.ts.
    mockTasksSelect.mockResolvedValue({ data: [], error: null });
    mockFilingsSelect.mockResolvedValue({ data: [], error: null });
    mockCaseUpdateMaybeSingle.mockResolvedValue({
      data: {
        id: CASE_ID,
        intake,
        timeline: [],
        payment_dispute_draft: null,
        client_state: merchantResolvedTerminalClientState,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        archived_at: null,
        case_label: null,
        paid_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    });
    vi.mocked(ensureOwnedFilingTaskAfterClientStateWrite).mockResolvedValue({
      ok: true,
      kind: null,
      timeline: null,
      created: false,
      task: null,
    });

    const res = await PATCH(
      buildPatchRequest({ client_state: merchantResolvedTerminalClientState }),
      routeContext()
    );

    // Not rejected by rejectManualOwnedStepClientStatePatch / rejectPrematureResolutionClientStatePatch —
    // the existing action's href isn't Surrenderless-owned, so no reject-gate exception was needed.
    expect(res.status).toBe(200);
    const body = await res.json();
    // Persisted and returned unchanged — the exact action the client computed and sent, not
    // replaced by a server-side recompute/advance (the route contains no such logic; see the
    // full trace in the PR description) and not the generic "nothing routable" fallback.
    expect(body.client_state.approved_next_action).toEqual(
      merchantResolvedTerminalClientState.approved_next_action
    );
    expect(body.client_state.approved_next_action.href).not.toBe(
      CHAT_INLINE_PACKET_FALLBACK_PREP_HREF
    );
    expect(body.client_state.approved_next_action.status).toBe("completed");

    // Proves actual persistence, not just the preconfigured mockCaseUpdateMaybeSingle return
    // value: the real argument the route passed to supabase.from("justice_cases").update(...)
    // must itself carry the terminal action.
    expect(mockCaseUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        client_state: expect.objectContaining({
          approved_next_action: expect.objectContaining({
            href: MERCHANT_RESOLVED_TERMINAL_HREF,
            status: "completed",
          }),
        }),
      })
    );

    // The route still routes every client_state write through the owned-filing-ensure gate —
    // it isn't skipped for this href — it's just that the (real, separately-proven) resolver
    // finds no owned-filing kind for it, so no task and no automated delivery ever fires.
    expect(ensureOwnedFilingTaskAfterClientStateWrite).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: USER_ID,
        caseId: CASE_ID,
        clientState: merchantResolvedTerminalClientState,
      })
    );
    expect(attemptAutomatedMerchantContactEmailDelivery).not.toHaveBeenCalled();
    expect(attemptAutomatedPaymentDisputeEmailDelivery).not.toHaveBeenCalled();
    expect(attemptAutomatedDemandLetterEmailDeliveryAfterEnsure).not.toHaveBeenCalled();
    // Reconciliation is attempted on every write that lands on the terminal action, regardless
    // of which prior href it came from — safe because the real function is idempotent (no-op
    // when no marker-matched task exists, exactly the case here since the generic fallback, not
    // /justice/merchant, was the existing action; see merchantContactFilingTask.test.ts).
    expect(completeMerchantContactFilingTaskIfOpen).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      CASE_ID
    );
  });
});

describe("PATCH /api/justice/cases/[id] merchant-resolved terminal transition from an owned /justice/merchant action", () => {
  // The OTHER reachable path to this terminal action: the consumer approved while
  // already_contacted was "no" (existing action becomes /justice/merchant, approved — an owned
  // step that may have queued a real merchant-contact operator task), then later documents
  // contact with merchant_response_type "resolved". This is not mutually exclusive with the
  // generic-fallback path covered in the describe block above.
  const resolvedIntake = buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    purchase_or_signup: "widget",
    story: "Never arrived, but the company sent a refund after I reached out.",
    money_amount: "$50.00",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-01-20",
    merchant_response_type: "resolved",
    contact_proof_type: "paste",
    contact_proof_text: "Refund confirmed by email",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    consumer_us_state: "CA",
    company_contact_email: "support@acme.example",
  });

  function openMerchantContactTask(): {
    id: string;
    user_id: string;
    case_id: string;
    title: string;
    due_date: string | null;
    notes: string;
    completed_at: string | null;
    created_at: string;
    updated_at: string;
  } {
    return {
      id: "task-merchant-contact-1",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Merchant contact: Acme Retail",
      due_date: null,
      notes: `merchant_contact_queue:${CASE_ID}\ncase_id: ${CASE_ID}`,
      completed_at: null,
      created_at: "2026-01-05T00:00:00.000Z",
      updated_at: "2026-01-05T00:00:00.000Z",
    };
  }

  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
    followUpTasksStore = [];
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: {
        client_state: merchantClientState,
        archived_at: null,
        updated_at: "2026-01-01T00:00:00.000Z",
        paid_at: "2026-01-01T00:00:00.000Z",
        intake: resolvedIntake,
      },
      error: null,
    });
    mockFilingsSelect.mockResolvedValue({ data: [], error: null });
    mockCaseUpdateMaybeSingle.mockResolvedValue({
      data: {
        id: CASE_ID,
        intake: resolvedIntake,
        timeline: [],
        payment_dispute_draft: null,
        client_state: merchantResolvedTerminalClientState,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        archived_at: null,
        case_label: null,
        paid_at: "2026-01-01T00:00:00.000Z",
      },
      error: null,
    });
    vi.mocked(ensureOwnedFilingTaskAfterClientStateWrite).mockResolvedValue({
      ok: true,
      kind: null,
      timeline: null,
      created: false,
      task: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("permits the transition and reconciles an OPEN owned merchant-contact task via the auditable completion path (never deletes it), writing the terminal action in the actual update payload", async () => {
    mockTasksSelect.mockResolvedValue({ data: [openMerchantContactTask()], error: null });
    vi.mocked(completeMerchantContactFilingTaskIfOpen).mockResolvedValue({
      task: { ...openMerchantContactTask(), completed_at: "2026-01-20T00:00:00.000Z" },
      timeline: [
        {
          id: "merchant_contact_task_done:task-merchant-contact-1",
          case_id: CASE_ID,
          type: "task_completed",
          label: "Merchant contact completed",
          ts: "2026-01-20T00:00:00.000Z",
        },
      ],
      completed: true,
    });

    const res = await PATCH(
      buildPatchRequest({ client_state: merchantResolvedTerminalClientState }),
      routeContext()
    );

    // Not rejected by rejectManualOwnedStepClientStatePatch — the narrow merchant-resolved
    // terminal exception permits this verified transition even though an open task otherwise
    // makes /justice/merchant an owned step.
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.client_state.approved_next_action).toEqual(
      merchantResolvedTerminalClientState.approved_next_action
    );

    // Actual Supabase update payload carries the terminal action — not just the mocked return.
    expect(mockCaseUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        client_state: expect.objectContaining({
          approved_next_action: expect.objectContaining({
            href: MERCHANT_RESOLVED_TERMINAL_HREF,
            status: "completed",
          }),
        }),
      })
    );

    // Task reconciliation: the auditable completion path is invoked for this case (no taskId —
    // marker-based lookup), never a delete, and its returned timeline is surfaced in the response.
    expect(completeMerchantContactFilingTaskIfOpen).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      CASE_ID
    );
    expect(body.timeline).toEqual(
      expect.arrayContaining([expect.objectContaining({ type: "task_completed" })])
    );

    // No unrelated owned-filing kind is queued for this href.
    expect(ensureOwnedFilingTaskAfterClientStateWrite).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        userId: USER_ID,
        caseId: CASE_ID,
        clientState: merchantResolvedTerminalClientState,
      })
    );
    expect(attemptAutomatedMerchantContactEmailDelivery).not.toHaveBeenCalled();
  });

  it("permits the same transition and is idempotent/safe when the owned merchant-contact task is already completed", async () => {
    const completedTask = { ...openMerchantContactTask(), completed_at: "2026-01-18T00:00:00.000Z" };
    mockTasksSelect.mockResolvedValue({ data: [completedTask], error: null });
    // Real no-op behavior: already-completed task, nothing to reconcile.
    vi.mocked(completeMerchantContactFilingTaskIfOpen).mockResolvedValue({
      task: completedTask,
      timeline: null,
      completed: false,
    });

    const res = await PATCH(
      buildPatchRequest({ client_state: merchantResolvedTerminalClientState }),
      routeContext()
    );

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.client_state.approved_next_action).toEqual(
      merchantResolvedTerminalClientState.approved_next_action
    );
    expect(mockCaseUpdatePatch).toHaveBeenCalledWith(
      expect.objectContaining({
        client_state: expect.objectContaining({
          approved_next_action: expect.objectContaining({
            href: MERCHANT_RESOLVED_TERMINAL_HREF,
            status: "completed",
          }),
        }),
      })
    );
    // Still invoked (idempotent, safe): completeMerchantContactFilingTaskIfOpen itself no-ops
    // when the task is already completed — it must never be skipped defensively at the route
    // layer, since that would make the route responsible for knowing task state it shouldn't.
    expect(completeMerchantContactFilingTaskIfOpen).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      CASE_ID
    );
  });

  it("reaches the real consumer closure gates once reconciliation is proven complete: no pending human-fulfillment escalation, and the archive gate opens", async () => {
    // Proves this ISN'T merely a persistence round trip — the same ladder-resolution functions
    // the chat UI's closure gates call are re-run here with the exact post-reconciliation task
    // state (completed, not open) to prove the case can actually reach consumer closure.
    const { hasPendingHumanFulfillmentEscalation, canArchiveCaseForEscalationLadder } =
      await import("@/lib/justice/escalationLadderResolution");
    const reconciledCompletedTask = {
      ...openMerchantContactTask(),
      completed_at: "2026-01-20T00:00:00.000Z",
    };

    expect(
      hasPendingHumanFulfillmentEscalation({
        approvedAction: merchantResolvedTerminalClientState.approved_next_action,
        caseId: CASE_ID,
        tasks: [reconciledCompletedTask],
      })
    ).toBe(false);
    expect(
      canArchiveCaseForEscalationLadder({
        approvedAction: merchantResolvedTerminalClientState.approved_next_action,
        caseId: CASE_ID,
        tasks: [reconciledCompletedTask],
        filings: [],
      })
    ).toBe(true);

    // And the negative control: if reconciliation had NOT happened (task still open), the same
    // gates correctly stay closed — proving the reconciliation step is load-bearing, not inert.
    expect(
      hasPendingHumanFulfillmentEscalation({
        approvedAction: merchantResolvedTerminalClientState.approved_next_action,
        caseId: CASE_ID,
        tasks: [openMerchantContactTask()],
      })
    ).toBe(true);
  });

  it("does NOT permit an unrelated owned action (CFPB) to use this exception even when intake confirms merchant-resolved and the incoming client_state impersonates the terminal shape", async () => {
    const cfpbApprovedClientState = {
      prepared_packet_approved: true,
      approved_next_action: {
        label: "CFPB",
        href: "/justice/cfpb",
        status: "approved",
      },
    };
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: {
        client_state: cfpbApprovedClientState,
        archived_at: null,
        updated_at: "2026-01-01T00:00:00.000Z",
        paid_at: "2026-01-01T00:00:00.000Z",
        intake: resolvedIntake,
      },
      error: null,
    });
    const openCfpbTask = {
      id: "task-cfpb-1",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "CFPB filing: Acme Retail",
      due_date: null,
      notes: `cfpb_filing_queue:${CASE_ID}`,
      completed_at: null,
      created_at: "2026-01-05T00:00:00.000Z",
      updated_at: "2026-01-05T00:00:00.000Z",
    };
    mockTasksSelect.mockResolvedValue({ data: [openCfpbTask], error: null });

    const res = await PATCH(
      buildPatchRequest({
        client_state: {
          prepared_packet_approved: true,
          approved_next_action: {
            ...cfpbApprovedClientState.approved_next_action,
            href: MERCHANT_RESOLVED_TERMINAL_HREF,
            status: "completed",
            completed_at: "2026-01-20T00:00:00.000Z",
          },
        },
      }),
      routeContext()
    );

    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/owned by Surrenderless operator fulfillment/i);
    // Never reached the write or task reconciliation — rejected before any of it.
    expect(mockCaseUpdatePatch).not.toHaveBeenCalled();
    expect(completeMerchantContactFilingTaskIfOpen).not.toHaveBeenCalled();
  });
});

describe("PATCH /api/justice/cases/[id] payment gating", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
    followUpTasksStore = [];
    mockTasksSelect.mockResolvedValue({ data: [], error: null });
    mockFilingsSelect.mockResolvedValue({ data: [], error: null });
    vi.mocked(ensureOwnedFilingTaskAfterClientStateWrite).mockResolvedValue({
      ok: true,
      kind: "merchant_contact",
      timeline: null,
      created: true,
      task: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("rejects the first prepared-packet-approval transition with 402 when the case is unpaid", async () => {
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: { client_state: {}, archived_at: null, paid_at: null },
      error: null,
    });

    const res = await PATCH(buildPatchRequest({ client_state: merchantClientState }), routeContext());

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({ requiresPayment: true });
    expect(ensureOwnedFilingTaskAfterClientStateWrite).not.toHaveBeenCalled();
  });

  it("allows the same approval transition once paid_at is set", async () => {
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: { client_state: {}, archived_at: null, paid_at: "2026-08-01T00:00:00.000Z", intake },
      error: null,
    });
    mockCaseUpdateMaybeSingle.mockResolvedValue({
      data: {
        id: CASE_ID,
        intake,
        timeline: [],
        payment_dispute_draft: null,
        client_state: merchantClientState,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        archived_at: null,
        case_label: null,
        paid_at: "2026-08-01T00:00:00.000Z",
      },
      error: null,
    });

    const res = await PATCH(buildPatchRequest({ client_state: merchantClientState }), routeContext());

    expect(res.status).toBe(200);
  });

  it("rejects the first merchant-contact approval with 422 when the case has no recipient email", async () => {
    const intakeNoRecipient = { ...intake, company_contact_email: "" };
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: {
        client_state: {},
        archived_at: null,
        paid_at: "2026-08-01T00:00:00.000Z",
        intake: intakeNoRecipient,
      },
      error: null,
    });

    const res = await PATCH(buildPatchRequest({ client_state: merchantClientState }), routeContext());

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.requiresMerchantContactEmail).toBe(true);
    expect(ensureOwnedFilingTaskAfterClientStateWrite).not.toHaveBeenCalled();
  });

  it("rejects the first demand-letter approval with 422 when the case has no company email", async () => {
    const intakeNoRecipient = { ...intake, company_contact_email: "" };
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: {
        client_state: {},
        archived_at: null,
        paid_at: "2026-08-01T00:00:00.000Z",
        intake: intakeNoRecipient,
      },
      error: null,
    });

    const res = await PATCH(
      buildPatchRequest({ client_state: demandLetterClientState }),
      routeContext()
    );

    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.requiresMerchantContactEmail).toBe(true);
    expect(ensureOwnedFilingTaskAfterClientStateWrite).not.toHaveBeenCalled();
  });

  it("allows a demand-letter approval with the operator-fallback flag set (no email required)", async () => {
    const intakeNoRecipient = { ...intake, company_contact_email: "" };
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: {
        client_state: {},
        archived_at: null,
        paid_at: "2026-08-01T00:00:00.000Z",
        intake: intakeNoRecipient,
      },
      error: null,
    });
    mockCaseUpdateMaybeSingle.mockResolvedValue({
      data: {
        id: CASE_ID,
        intake: intakeNoRecipient,
        timeline: [],
        payment_dispute_draft: null,
        client_state: demandLetterClientState,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        archived_at: null,
        case_label: null,
        paid_at: "2026-08-01T00:00:00.000Z",
      },
      error: null,
    });

    const res = await PATCH(
      buildPatchRequest({
        client_state: { ...demandLetterClientState, merchant_contact_operator_fallback: true },
      }),
      routeContext()
    );

    expect(res.status).toBe(200);
  });

  it("never blocks a case that is already approved/in-progress, even while unpaid", async () => {
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: { client_state: merchantClientState, archived_at: null, paid_at: null },
      error: null,
    });
    mockCaseUpdateMaybeSingle.mockResolvedValue({
      data: {
        id: CASE_ID,
        intake,
        timeline: [],
        payment_dispute_draft: null,
        client_state: merchantFollowUpClearedClientState,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        archived_at: null,
        case_label: null,
        paid_at: null,
      },
      error: null,
    });
    mockFilingsSelect.mockResolvedValue({
      data: [{ destination: "Small claims / demand letter", confirmation_number: "DL-DONE-1" }],
      error: null,
    });

    const res = await PATCH(
      buildPatchRequest({ client_state: merchantFollowUpClearedClientState }),
      routeContext()
    );

    expect(res.status).toBe(200);
  });

  it("never blocks intake-only writes (no client_state in the patch, so the gate never runs)", async () => {
    mockCaseUpdateMaybeSingle.mockResolvedValue({
      data: {
        id: CASE_ID,
        intake,
        timeline: [],
        payment_dispute_draft: null,
        client_state: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        archived_at: null,
        case_label: null,
        paid_at: null,
      },
      error: null,
    });

    const res = await PATCH(buildPatchRequest({ intake }), routeContext());

    expect(res.status).toBe(200);
  });
});

function followUpRow(id: string, ownerHref: string, ownerLabel: string): FollowUpTaskRow {
  return {
    id,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: `Surrenderless follow-up: ${ownerLabel}`,
    due_date: null,
    notes: `follow_up:${CASE_ID}\nowner_href:${ownerHref}`,
    completed_at: null,
    created_at: "2026-06-01T00:00:00.000Z",
    updated_at: "2026-06-01T00:00:00.000Z",
  };
}

const merchantFollowUpNeededClientState = {
  prepared_packet_approved: true,
  approved_next_action: {
    label: "Merchant contact",
    href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
    status: "approved",
    follow_up_needed: true,
  },
};

const merchantFollowUpClearedClientState = {
  prepared_packet_approved: true,
  approved_next_action: {
    label: "Merchant contact",
    href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
    status: "approved",
    follow_up_needed: false,
    outcome_note: "Customer resolved directly.",
  },
};

describe("PATCH /api/justice/cases/[id] follow-up clearing — multiple simultaneously open lanes", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
    followUpTasksStore = [];
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: { client_state: merchantFollowUpNeededClientState, archived_at: null },
      error: null,
    });
    mockTasksSelect.mockResolvedValue({ data: [], error: null });
    // Clearing an owned step's outcome/follow-up tracking is only allowed once the escalation
    // ladder has reached its terminal step (demand letter) with a confirmed filing — otherwise
    // rejectPrematureResolutionClientStatePatch blocks the patch outright. Unrelated to the
    // multi-open-follow-up behavior under test here; just satisfying that separate, pre-existing
    // gate so this test can reach it.
    mockFilingsSelect.mockResolvedValue({
      data: [{ destination: "Small claims / demand letter", confirmation_number: "DL-DONE-1" }],
      error: null,
    });
    mockCaseUpdateMaybeSingle.mockResolvedValue({
      data: {
        id: CASE_ID,
        intake,
        timeline: [],
        payment_dispute_draft: null,
        client_state: merchantFollowUpClearedClientState,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        archived_at: null,
        case_label: null,
      },
      error: null,
    });
    vi.mocked(ensureOwnedFilingTaskAfterClientStateWrite).mockResolvedValue({
      ok: true,
      kind: null,
      timeline: null,
      created: false,
      task: null,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("closes only the merchant-owned follow-up and leaves payment dispute's open — merchant row seeded first", async () => {
    followUpTasksStore = [
      followUpRow("task-merchant", MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF, "Merchant contact"),
      followUpRow(
        "task-payment-dispute",
        MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
        "Payment dispute (bank/card)"
      ),
    ];

    const res = await PATCH(
      buildPatchRequest({ client_state: merchantFollowUpClearedClientState }),
      routeContext()
    );

    expect(res.status).toBe(200);
    expect(followUpTasksStore.find((t) => t.id === "task-merchant")?.completed_at).toBeTruthy();
    expect(followUpTasksStore.find((t) => t.id === "task-payment-dispute")?.completed_at).toBeNull();
  });

  it("closes only the merchant-owned follow-up and leaves payment dispute's open — payment dispute row seeded first (row order must not matter)", async () => {
    followUpTasksStore = [
      followUpRow(
        "task-payment-dispute",
        MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
        "Payment dispute (bank/card)"
      ),
      followUpRow("task-merchant", MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF, "Merchant contact"),
    ];

    const res = await PATCH(
      buildPatchRequest({ client_state: merchantFollowUpClearedClientState }),
      routeContext()
    );

    expect(res.status).toBe(200);
    expect(followUpTasksStore.find((t) => t.id === "task-merchant")?.completed_at).toBeTruthy();
    expect(followUpTasksStore.find((t) => t.id === "task-payment-dispute")?.completed_at).toBeNull();
  });

  it("safely no-ops (does not close either row) when the cleared action's href can't be determined", async () => {
    mockCaseSelectMaybeSingle.mockResolvedValue({
      data: {
        client_state: {
          prepared_packet_approved: true,
          approved_next_action: { follow_up_needed: true },
        },
        archived_at: null,
      },
      error: null,
    });
    followUpTasksStore = [
      followUpRow("task-merchant", MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF, "Merchant contact"),
      followUpRow(
        "task-payment-dispute",
        MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
        "Payment dispute (bank/card)"
      ),
    ];

    const res = await PATCH(
      buildPatchRequest({
        client_state: {
          prepared_packet_approved: true,
          approved_next_action: { follow_up_needed: false },
        },
      }),
      routeContext()
    );

    expect(res.status).toBe(200);
    expect(followUpTasksStore.find((t) => t.id === "task-merchant")?.completed_at).toBeNull();
    expect(followUpTasksStore.find((t) => t.id === "task-payment-dispute")?.completed_at).toBeNull();
  });
});
