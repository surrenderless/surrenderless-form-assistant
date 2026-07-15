import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { EmailProvider } from "@/lib/email/emailProvider";
import {
  attemptAutomatedDemandLetterEmailDelivery,
  buildDemandLetterOutreachEmailSubject,
  demandLetterEmailIdempotencyKey,
  formatDemandLetterOutreachEmailBody,
  isDemandLetterEmailFailed,
  isDemandLetterEmailSending,
  parseDemandLetterEmailDeliveryRecord,
  resolveDemandLetterRecipientEmail,
  upsertDemandLetterEmailDeliveryNotes,
} from "@/lib/justice/demandLetterEmailDelivery";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import type { JusticeIntake } from "@/lib/justice/types";
import { buildDemandLetterDraft } from "@/lib/justice/buildDemandLetterDraft";
import {
  buildDemandLetterFilingTaskNotes,
  demandLetterFilingTaskNotesMarker,
} from "@/lib/justice/demandLetterFilingTask";

vi.mock("@/lib/email/resolveMerchantOutreachEmailProvider", () => ({
  resolveMerchantOutreachEmailProvider: vi.fn(),
}));

vi.mock("@/lib/justice/completeDemandLetterOperatorFiling", () => ({
  completeDemandLetterOperatorFiling: vi.fn(),
}));

vi.mock("@/server/justiceTimelineAppend", () => ({
  appendCaseTimelineEntry: vi.fn(async (_s, _u, _c, entry) => [entry]),
}));

vi.mock("@/lib/justice/surrenderlessOwnedStep", () => ({
  shouldSuppressChatManualActionForSurrenderlessOwnedStep: vi.fn(() => true),
}));

import { resolveMerchantOutreachEmailProvider } from "@/lib/email/resolveMerchantOutreachEmailProvider";
import { completeDemandLetterOperatorFiling } from "@/lib/justice/completeDemandLetterOperatorFiling";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "user_1";
const TASK_ID = "22222222-2222-4222-8222-222222222222";

function baseIntake(overrides: Partial<JusticeIntake> = {}): JusticeIntake {
  return {
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    company_website: "https://acme.example",
    company_contact_email: "support@acme.example",
    purchase_or_signup: "widget",
    story: "Never arrived",
    money_involved: "$50",
    pay_or_order_date: "2026-01-01",
    order_confirmation_details: "ORD-1",
    user_display_name: "Pat Consumer",
    reply_email: "pat@example.com",
    already_contacted: "no",
    ...overrides,
  };
}

function makeOpenTask(notes?: string): JusticeCaseTaskRow {
  const intake = baseIntake();
  return {
    id: TASK_ID,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "Demand letter: Acme Retail",
    due_date: null,
    notes: notes ?? buildDemandLetterFilingTaskNotes(CASE_ID, intake),
    completed_at: null,
    created_at: "2026-07-14T00:00:00.000Z",
    updated_at: "2026-07-14T00:00:00.000Z",
  };
}

function makeSupabase(handlers: {
  caseRow?: Record<string, unknown> | null;
  tasks?: JusticeCaseTaskRow[];
  filings?: unknown[];
  onTaskNotesUpdate?: (notes: string) => void;
}): SupabaseClient {
  const caseRow =
    handlers.caseRow === undefined
      ? {
          intake: baseIntake(),
          client_state: {
            prepared_packet_approved: true,
            approved_next_action: {
              label: "Small claims / demand letter",
              href: "/justice/demand-letter",
              status: "approved",
            },
          },
          timeline: [],
        }
      : handlers.caseRow;
  const tasks = handlers.tasks ?? [makeOpenTask()];
  const filings = handlers.filings ?? [];
  let taskNotes = tasks[0]?.notes ?? "";

  return {
    from(table: string) {
      if (table === "justice_cases") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: caseRow, error: null }),
              }),
            }),
          }),
        };
      }
      if (table === "justice_case_tasks") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: tasks, error: null }),
            }),
          }),
          update: (patch: { notes?: string }) => ({
            eq: () => ({
              eq: () => ({
                select: () => ({
                  maybeSingle: async () => {
                    if (patch.notes !== undefined) {
                      taskNotes = patch.notes;
                      handlers.onTaskNotesUpdate?.(patch.notes);
                      const updated = { ...tasks[0], notes: patch.notes };
                      tasks[0] = updated;
                    }
                    return { data: { ...tasks[0], notes: taskNotes }, error: null };
                  },
                }),
              }),
            }),
          }),
        };
      }
      if (table === "justice_case_filings") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: filings, error: null }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("demandLetterEmailDelivery helpers", () => {
  it("resolves company_contact_email only when valid", () => {
    expect(resolveDemandLetterRecipientEmail(baseIntake({ company_contact_email: undefined }))).toBeNull();
    expect(resolveDemandLetterRecipientEmail(baseIntake())).toBe("support@acme.example");
    expect(
      resolveDemandLetterRecipientEmail(baseIntake({ company_contact_email: "not-an-email" }))
    ).toBeNull();
  });

  it("round-trips delivery records in task notes without dropping the draft", () => {
    const notes = `${demandLetterFilingTaskNotesMarker(CASE_ID)}\ndraft:\nDEMAND LETTER BODY`;
    const withSending = upsertDemandLetterEmailDeliveryNotes(notes, {
      delivery_state: "sending",
      provider: "resend",
      recipient: "support@acme.example",
      sent_at: "2026-07-14T12:00:00.000Z",
    });
    expect(withSending).toContain("draft:\nDEMAND LETTER BODY");
    expect(parseDemandLetterEmailDeliveryRecord(withSending)).toEqual({
      delivery_state: "sending",
      provider: "resend",
      recipient: "support@acme.example",
      sent_at: "2026-07-14T12:00:00.000Z",
    });

    const withFailed = upsertDemandLetterEmailDeliveryNotes(withSending, {
      delivery_state: "failed",
      provider: "resend",
      recipient: "support@acme.example",
      sent_at: "2026-07-14T12:01:00.000Z",
      failure_detail: "mailbox unavailable",
    });
    expect(parseDemandLetterEmailDeliveryRecord(withFailed)?.delivery_state).toBe("failed");
    expect(withFailed).toContain("DEMAND LETTER BODY");
  });

  it("detects sending and failed states on open tasks", () => {
    const sendingTask = makeOpenTask(
      upsertDemandLetterEmailDeliveryNotes("marker", {
        delivery_state: "sending",
        provider: "resend",
        recipient: "a@b.co",
      })
    );
    expect(isDemandLetterEmailSending(sendingTask)).toBe(true);
    expect(isDemandLetterEmailFailed(sendingTask)).toBe(false);

    const failedTask = {
      ...sendingTask,
      notes: upsertDemandLetterEmailDeliveryNotes(sendingTask.notes, {
        delivery_state: "failed",
        provider: "resend",
        recipient: "a@b.co",
        failure_detail: "bounce",
      }),
    };
    expect(isDemandLetterEmailSending(failedTask)).toBe(false);
    expect(isDemandLetterEmailFailed(failedTask)).toBe(true);
  });

  it("builds subject, idempotency key, and strips prep disclaimers from outbound body", () => {
    expect(buildDemandLetterOutreachEmailSubject(baseIntake())).toContain("Acme Retail");
    expect(demandLetterEmailIdempotencyKey("  case-uuid  ")).toBe("demand-letter-email:case-uuid");
    const draft = buildDemandLetterDraft(baseIntake());
    const body = formatDemandLetterOutreachEmailBody(draft);
    expect(body).not.toMatch(/DRAFT DEMAND LETTER/i);
    expect(body).not.toMatch(/This app does not send/i);
    expect(body).toContain("Acme Retail");
    expect(body).toContain("Dear Sir or Madam");
  });
});

describe("attemptAutomatedDemandLetterEmailDelivery", () => {
  beforeEach(() => {
    vi.mocked(resolveMerchantOutreachEmailProvider).mockReset();
    vi.mocked(completeDemandLetterOperatorFiling).mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("skips when company_contact_email is missing (operator fallback)", async () => {
    const result = await attemptAutomatedDemandLetterEmailDelivery(
      makeSupabase({
        caseRow: {
          intake: baseIntake({ company_contact_email: undefined }),
          client_state: {
            prepared_packet_approved: true,
            approved_next_action: {
              label: "Small claims / demand letter",
              href: "/justice/demand-letter",
              status: "approved",
            },
          },
          timeline: [],
        },
      }),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: expect.stringContaining("company_contact_email"),
    });
    expect(completeDemandLetterOperatorFiling).not.toHaveBeenCalled();
  });

  it("skips when Resend provider env is unconfigured (operator fallback)", async () => {
    vi.mocked(resolveMerchantOutreachEmailProvider).mockReturnValue({
      ok: false,
      reason: "RESEND_API_KEY is not configured",
    });
    const result = await attemptAutomatedDemandLetterEmailDelivery(
      makeSupabase({}),
      USER_ID,
      CASE_ID
    );
    expect(result).toMatchObject({
      status: "skipped",
      reason: expect.stringContaining("RESEND_API_KEY"),
    });
    expect(completeDemandLetterOperatorFiling).not.toHaveBeenCalled();
  });

  it("leaves task open as failed when provider rejects delivery", async () => {
    const provider: EmailProvider = {
      name: "resend",
      send: vi.fn(async () => ({ ok: false as const, error: "mailbox unavailable", retryable: true })),
    };
    vi.mocked(resolveMerchantOutreachEmailProvider).mockReturnValue({
      ok: true,
      provider,
      from: "outreach@surrenderless.test",
    });

    const noteUpdates: string[] = [];
    const result = await attemptAutomatedDemandLetterEmailDelivery(
      makeSupabase({ onTaskNotesUpdate: (n) => noteUpdates.push(n) }),
      USER_ID,
      CASE_ID
    );

    expect(result.status).toBe("failed");
    if (result.status === "failed") {
      expect(result.error).toContain("mailbox unavailable");
    }
    expect(completeDemandLetterOperatorFiling).not.toHaveBeenCalled();
    expect(noteUpdates.some((n) => n.includes("delivery_state: failed"))).toBe(true);
    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "support@acme.example",
        idempotencyKey: demandLetterEmailIdempotencyKey(CASE_ID),
      })
    );
  });

  it("completes only after provider acceptance through completeDemandLetterOperatorFiling", async () => {
    const send = vi.fn(async (req: { idempotencyKey: string }) => ({
      ok: true as const,
      messageId: `msg_${req.idempotencyKey}`,
    }));
    const provider: EmailProvider = { name: "resend", send };
    vi.mocked(resolveMerchantOutreachEmailProvider).mockReturnValue({
      ok: true,
      provider,
      from: "outreach@surrenderless.test",
    });
    vi.mocked(completeDemandLetterOperatorFiling).mockResolvedValue({
      ok: true,
      filing: {
        id: "f1",
        user_id: USER_ID,
        case_id: CASE_ID,
        destination: "Small claims / demand letter",
        filed_at: "2026-07-14",
        confirmation_number: `msg_${demandLetterEmailIdempotencyKey(CASE_ID)}`,
        filing_url: null,
        notes: null,
        created_at: "2026-07-14T00:00:00.000Z",
        updated_at: "2026-07-14T00:00:00.000Z",
      },
      task: {
        ...makeOpenTask(),
        completed_at: "2026-07-14T12:00:00.000Z",
      },
      clientState: {
        prepared_packet_approved: true,
        approved_next_action: {
          href: "/justice/demand-letter",
          status: "completed",
          follow_up_needed: true,
        },
      },
      timeline: [],
      advanced: false,
      idempotent: false,
    });

    const result = await attemptAutomatedDemandLetterEmailDelivery(
      makeSupabase({}),
      USER_ID,
      CASE_ID
    );

    expect(result.status).toBe("accepted");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        from: "outreach@surrenderless.test",
        to: "support@acme.example",
        subject: expect.stringContaining("Demand letter"),
        text: expect.stringContaining("Dear Sir or Madam"),
        replyTo: "pat@example.com",
        idempotencyKey: demandLetterEmailIdempotencyKey(CASE_ID),
      })
    );
    expect(completeDemandLetterOperatorFiling).toHaveBeenCalledWith(
      expect.anything(),
      USER_ID,
      expect.objectContaining({
        caseId: CASE_ID,
        taskId: TASK_ID,
        destination: "Small claims / demand letter",
        confirmationNumber: `msg_${demandLetterEmailIdempotencyKey(CASE_ID)}`,
      })
    );
  });

  it("reuses idempotent acceptance without a second provider send", async () => {
    const notes = upsertDemandLetterEmailDeliveryNotes(buildDemandLetterFilingTaskNotes(CASE_ID, baseIntake()), {
      delivery_state: "accepted",
      provider: "resend",
      recipient: "support@acme.example",
      provider_message_id: "msg_existing",
      sent_at: "2026-07-14T12:00:00.000Z",
    });
    const send = vi.fn();
    vi.mocked(resolveMerchantOutreachEmailProvider).mockReturnValue({
      ok: true,
      provider: { name: "resend", send },
      from: "outreach@surrenderless.test",
    });

    const result = await attemptAutomatedDemandLetterEmailDelivery(
      makeSupabase({ tasks: [makeOpenTask(notes)] }),
      USER_ID,
      CASE_ID
    );

    expect(result).toMatchObject({
      status: "accepted",
      messageId: "msg_existing",
      idempotent: true,
    });
    expect(send).not.toHaveBeenCalled();
    expect(completeDemandLetterOperatorFiling).not.toHaveBeenCalled();
  });
});
