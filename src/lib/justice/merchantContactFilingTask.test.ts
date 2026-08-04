import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildJusticeIntakeFromParts } from "@/lib/justice/buildJusticeIntake";
import {
  merchantContactFilingTaskCompletedTimelineId,
  merchantContactFilingTaskNotesMarker,
  buildMerchantContactEvidenceInventory,
  buildMerchantContactFilingTaskNotes,
  buildMerchantContactFilingTaskTitle,
  buildMerchantContactIdentityBlock,
  findLatestMerchantContactFiling,
  findLatestMerchantContactFilingCreatedAt,
  findOpenMerchantContactFilingTask,
  hasMerchantContactFilingRecord,
  hasMerchantContactFilingWithConfirmation,
  parseMerchantContactFilingTaskDraft,
  reopenMerchantContactFilingTaskForBounce,
  shouldQueueMerchantContactFilingTask,
  taskNotesMatchMerchantContactFilingMarker,
} from "@/lib/justice/merchantContactFilingTask";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake() {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    problem_category: "online_purchase",
    company_name: "Acme Retail",
    company_website: "https://acme.example",
    purchase_or_signup: "widget order",
    consumer_us_state: "CA",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    story: "Ordered a widget that never arrived and merchant refused a refund.",
    already_contacted: "no",
  });
}

describe("merchantContactFilingTask", () => {
  it("uses a stable notes marker per case", () => {
    expect(merchantContactFilingTaskNotesMarker(CASE_ID)).toBe(`merchant_contact_queue:${CASE_ID}`);
  });

  it("builds title from company name", () => {
    expect(buildMerchantContactFilingTaskTitle(baseIntake())).toBe("Merchant contact: Acme Retail");
  });

  it("builds company-contact title when CFPB-relevant", () => {
    const intake = buildJusticeIntakeFromParts({
      ...defaultBuildJusticeIntakeParts(),
      problem_category: "financial_account_issue",
      company_name: "Acme Bank",
      purchase_or_signup: "checking account",
      story: "Unauthorized fees after closing the account.",
      already_contacted: "no",
    });
    expect(buildMerchantContactFilingTaskTitle(intake)).toBe("Company contact: Acme Bank");
  });

  it("builds stable completed timeline id", () => {
    expect(merchantContactFilingTaskCompletedTimelineId("task-1")).toBe(
      "merchant_contact_task_done:task-1"
    );
  });

  it("detects merchant contact filing records and confirmation", () => {
    const filings: JusticeCaseFilingRow[] = [
      {
        id: "fil-1",
        user_id: "user",
        case_id: CASE_ID,
        destination: "FTC (consumer complaint)",
        filed_at: "2026-01-01",
        confirmation_number: "ftc-1",
        filing_url: null,
        notes: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "fil-2",
        user_id: "user",
        case_id: CASE_ID,
        destination: "Merchant contact",
        filed_at: "2026-01-02",
        confirmation_number: null,
        filing_url: null,
        notes: null,
        created_at: "2026-01-02T00:00:00.000Z",
        updated_at: "2026-01-02T00:00:00.000Z",
      },
    ];
    expect(hasMerchantContactFilingRecord(filings)).toBe(true);
    expect(hasMerchantContactFilingWithConfirmation(filings)).toBe(false);
    expect(
      hasMerchantContactFilingWithConfirmation([
        { ...filings[1]!, confirmation_number: "merchant-123" },
      ])
    ).toBe(true);
  });

  it("findLatestMerchantContactFiling picks the most recently created filing regardless of confirmation state", () => {
    const older = {
      id: "fil-mc-older",
      user_id: "user",
      case_id: CASE_ID,
      destination: "Merchant contact",
      filed_at: "2026-06-01",
      confirmation_number: "re_bounced",
      filing_url: null,
      notes: null,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const newer = {
      ...older,
      id: "fil-mc-newer",
      confirmation_number: "MC-REMEDIATED",
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
    };
    expect(findLatestMerchantContactFiling([older, newer])?.id).toBe("fil-mc-newer");
    expect(findLatestMerchantContactFiling([newer, older])?.id).toBe("fil-mc-newer");
    expect(findLatestMerchantContactFiling([])).toBeUndefined();
  });

  it("builds identity block and notes with packet, evidence, and draft", () => {
    const identity = buildMerchantContactIdentityBlock(baseIntake());
    expect(identity).toContain("merchant/company: Acme Retail");
    expect(identity).toContain("consumer: Jordan Lee");

    const notes = buildMerchantContactFilingTaskNotes(CASE_ID, baseIntake(), [
      { title: "Order receipt", evidence_type: "screenshot", evidence_date: "2026-01-09" },
    ]);
    expect(notes.startsWith(`merchant_contact_queue:${CASE_ID}\n`)).toBe(true);
    expect(notes).toContain(`case_id: ${CASE_ID}`);
    expect(notes).toContain("merchant_identity:");
    expect(notes).toContain("packet:");
    expect(notes).toContain("JUSTICE CASE PACKET");
    expect(notes).toContain("evidence:");
    expect(notes).toContain("1. [screenshot] Order receipt (2026-01-09)");
    expect(notes).toContain("draft:");
    expect(notes.length).toBeLessThanOrEqual(8000);
  });

  it("formats empty evidence inventory", () => {
    expect(buildMerchantContactEvidenceInventory([])).toBe(
      "(no saved evidence rows on this case yet)"
    );
  });

  it("matches marker-only and structured notes", () => {
    const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
    expect(taskNotesMatchMerchantContactFilingMarker(marker, CASE_ID)).toBe(true);
    expect(taskNotesMatchMerchantContactFilingMarker(`${marker}\ncase_id: ${CASE_ID}`, CASE_ID)).toBe(
      true
    );
    expect(taskNotesMatchMerchantContactFilingMarker("other task", CASE_ID)).toBe(false);
  });

  it("parses draft body from task notes", () => {
    const notes = buildMerchantContactFilingTaskNotes(CASE_ID, baseIntake());
    const draft = parseMerchantContactFilingTaskDraft(notes);
    expect(draft.length).toBeGreaterThan(0);
    expect(draft).toContain("Acme Retail");
  });

  it("finds open merchant contact filing task", () => {
    const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
    const tasks: JusticeCaseTaskRow[] = [
      {
        id: "task-1",
        user_id: "user",
        case_id: CASE_ID,
        title: "Merchant contact: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}`,
        completed_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(findOpenMerchantContactFilingTask(tasks, CASE_ID)?.id).toBe("task-1");
    expect(
      findOpenMerchantContactFilingTask(
        [{ ...tasks[0]!, completed_at: "2026-06-22T00:00:00.000Z" }],
        CASE_ID
      )
    ).toBeUndefined();
  });

  it("shouldQueueMerchantContactFilingTask when packet approved and next action is owned merchant", () => {
    expect(
      shouldQueueMerchantContactFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Merchant contact",
          href: "/justice/merchant",
          status: "approved",
        },
      })
    ).toBe(true);
    expect(
      shouldQueueMerchantContactFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Merchant contact",
          href: "/justice/merchant",
          status: "completed",
        },
      })
    ).toBe(false);
    expect(
      shouldQueueMerchantContactFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "FTC (consumer complaint)",
          href: "/justice/ftc",
          status: "approved",
        },
      })
    ).toBe(false);
    expect(
      shouldQueueMerchantContactFilingTask({
        prepared_packet_approved: false,
        approved_next_action: {
          label: "Merchant contact",
          href: "/justice/merchant",
          status: "approved",
        },
      })
    ).toBe(false);
  });
});

describe("reopenMerchantContactFilingTaskForBounce", () => {
  const USER_ID = "user-mc-bounce";

  function makeCompletedTask(): JusticeCaseTaskRow {
    const marker = merchantContactFilingTaskNotesMarker(CASE_ID);
    return {
      id: "task-mc-bounce",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Merchant contact: Acme Retail",
      due_date: null,
      notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nDear Acme Retail...`,
      completed_at: "2026-01-10T00:00:00.000Z",
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-10T00:00:00.000Z",
    };
  }

  function makeSupabase(task: JusticeCaseTaskRow | null) {
    const store = { task: task ? { ...task } : null, timeline: [] as unknown[] };
    return {
      from(table: string) {
        if (table === "justice_case_tasks") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({
                  like: () => ({
                    order: () => ({
                      limit: async () => ({
                        data: store.task ? [store.task] : [],
                        error: null,
                      }),
                    }),
                  }),
                }),
              }),
            }),
            update: (payload: Record<string, unknown>) => ({
              eq: () => ({
                eq: () => ({
                  select: () => ({
                    maybeSingle: async () => {
                      if (!store.task) return { data: null, error: null };
                      store.task = { ...store.task, ...payload } as JusticeCaseTaskRow;
                      return { data: store.task, error: null };
                    },
                  }),
                }),
              }),
            }),
          };
        }
        if (table === "justice_cases") {
          return {
            select: () => ({
              eq: () => ({
                eq: () => ({ maybeSingle: async () => ({ data: { timeline: store.timeline }, error: null }) }),
              }),
            }),
            update: (payload: Record<string, unknown>) => ({
              eq: () => ({
                eq: () => {
                  store.timeline = payload.timeline as unknown[];
                  return { data: null, error: null };
                },
              }),
            }),
          };
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient;
  }

  it("reopens a completed task, prefixes the title, and appends an actionable timeline entry", async () => {
    const supabase = makeSupabase(makeCompletedTask());

    const result = await reopenMerchantContactFilingTaskForBounce(
      supabase,
      USER_ID,
      CASE_ID,
      "bounced"
    );

    expect(result.reopened).toBe(true);
    expect(result.task?.completed_at).toBeNull();
    expect(result.task?.title).toBe("[Needs manual follow-up — bounced] Merchant contact: Acme Retail");
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline?.[0]?.label).toBe("Merchant contact task reopened for manual follow-up");
  });

  it("uses a distinct title prefix for a spam complaint", async () => {
    const supabase = makeSupabase(makeCompletedTask());

    const result = await reopenMerchantContactFilingTaskForBounce(
      supabase,
      USER_ID,
      CASE_ID,
      "complained"
    );

    expect(result.task?.title).toBe(
      "[Needs manual follow-up — marked as spam] Merchant contact: Acme Retail"
    );
  });

  it("is a no-op (not reopened) when no matching task exists for the case", async () => {
    const supabase = makeSupabase(null);

    const result = await reopenMerchantContactFilingTaskForBounce(
      supabase,
      USER_ID,
      CASE_ID,
      "bounced"
    );

    expect(result).toEqual({ task: null, timeline: null, reopened: false });
  });
});

describe("findLatestMerchantContactFilingCreatedAt", () => {
  const USER_ID = "user-mc-latest";

  function makeFilingsSupabase(filings: JusticeCaseFilingRow[]) {
    return {
      from(table: string) {
        if (table !== "justice_case_filings") throw new Error(`unexpected table ${table}`);
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: filings, error: null }),
            }),
          }),
        };
      },
    } as unknown as import("@supabase/supabase-js").SupabaseClient;
  }

  function merchantContactFiling(id: string, createdAt: string): JusticeCaseFilingRow {
    return {
      id,
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Merchant contact",
      filed_at: createdAt.slice(0, 10),
      confirmation_number: `conf-${id}`,
      filing_url: null,
      notes: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
  }

  it("returns the created_at of the most recently created merchant-contact filing", async () => {
    const supabase = makeFilingsSupabase([
      merchantContactFiling("fil-1", "2026-06-01T00:00:00.000Z"),
      merchantContactFiling("fil-2", "2026-06-21T00:00:00.000Z"),
    ]);

    await expect(findLatestMerchantContactFilingCreatedAt(supabase, USER_ID, CASE_ID)).resolves.toBe(
      "2026-06-21T00:00:00.000Z"
    );
  });

  it("returns null when no merchant-contact filing exists yet", async () => {
    const supabase = makeFilingsSupabase([]);

    await expect(findLatestMerchantContactFilingCreatedAt(supabase, USER_ID, CASE_ID)).resolves.toBeNull();
  });

  it('returns "error" on a select error rather than throwing or reporting confirmed absence', async () => {
    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: async () => ({ data: null, error: { message: "select down" } }),
          }),
        }),
      }),
    } as unknown as import("@supabase/supabase-js").SupabaseClient;

    await expect(findLatestMerchantContactFilingCreatedAt(supabase, USER_ID, CASE_ID)).resolves.toBe("error");
  });
});
