import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  buildJusticeIntakeFromParts,
  defaultBuildJusticeIntakeParts,
} from "@/lib/justice/buildJusticeIntake";
import { MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";

const mockCaseSelectMaybeSingle = vi.fn();
const mockCaseUpdateMaybeSingle = vi.fn();
const mockTasksSelect = vi.fn();
const mockFilingsSelect = vi.fn();

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

vi.mock("@/lib/justice/followUpCaseTask", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/justice/followUpCaseTask")>();
  return {
    ...actual,
    completeFollowUpCaseTaskIfOpen: vi.fn(async () => ({ timeline: null })),
  };
});

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
              eq: () => mockTasksSelect(),
            }),
          }),
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
