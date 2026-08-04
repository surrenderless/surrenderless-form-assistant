import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  buildJusticeIntakeFromParts,
  defaultBuildJusticeIntakeParts,
} from "@/lib/justice/buildJusticeIntake";
import {
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";

const mockCaseSelectMaybeSingle = vi.fn();
const mockCaseUpdateMaybeSingle = vi.fn();
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
          update: () => ({
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
          }),
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
      data: { client_state: {}, archived_at: null },
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
      data: { client_state: {}, archived_at: null, updated_at: "2026-01-01T00:00:00.000Z" },
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
