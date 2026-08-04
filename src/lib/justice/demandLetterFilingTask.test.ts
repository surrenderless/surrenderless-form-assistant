import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaultBuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import { buildJusticeIntakeFromParts } from "@/lib/justice/buildJusticeIntake";
import {
  buildDemandLetterFilingTaskNotes,
  buildDemandLetterFilingTaskTitle,
  demandLetterFilingTaskCompletedTimelineId,
  demandLetterFilingTaskNotesMarker,
  findLatestDemandLetterFiling,
  findLatestDemandLetterFilingCreatedAt,
  findOpenDemandLetterFilingTask,
  hasDemandLetterFilingRecord,
  hasDemandLetterFilingWithConfirmation,
  parseDemandLetterFilingTaskDraft,
  reopenDemandLetterFilingTaskForBounce,
  shouldQueueDemandLetterFilingTask,
  taskNotesMatchDemandLetterFilingMarker,
} from "@/lib/justice/demandLetterFilingTask";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

function baseIntake() {
  return buildJusticeIntakeFromParts({
    ...defaultBuildJusticeIntakeParts(),
    company_name: "Acme Retail",
    user_display_name: "Jordan Lee",
    reply_email: "e2e@example.com",
    story: "Double charge on widget order.",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2026-01-15",
    merchant_response_type: "refused_help",
    contact_proof_type: "paste",
    contact_proof_text: "Refused refund by email.",
  });
}

describe("demandLetterFilingTask", () => {
  it("uses a stable notes marker per case", () => {
    expect(demandLetterFilingTaskNotesMarker(CASE_ID)).toBe(
      `demand_letter_filing_queue:${CASE_ID}`
    );
  });

  it("builds title from company name", () => {
    expect(buildDemandLetterFilingTaskTitle(baseIntake())).toBe("Demand letter: Acme Retail");
  });

  it("builds stable completed timeline id", () => {
    expect(demandLetterFilingTaskCompletedTimelineId("task-dl-1")).toBe(
      "demand_letter_filing_task_done:task-dl-1"
    );
  });

  it("detects demand letter filing records and confirmation", () => {
    const filings: JusticeCaseFilingRow[] = [
      {
        id: "fil-dl-1",
        user_id: "user",
        case_id: CASE_ID,
        destination: "Small claims / demand letter",
        filed_at: "2026-01-03",
        confirmation_number: null,
        filing_url: null,
        notes: null,
        created_at: "2026-01-03T00:00:00.000Z",
        updated_at: "2026-01-03T00:00:00.000Z",
      },
    ];
    expect(hasDemandLetterFilingRecord(filings)).toBe(true);
    expect(hasDemandLetterFilingWithConfirmation(filings)).toBe(false);
    expect(
      hasDemandLetterFilingWithConfirmation([
        { ...filings[0]!, confirmation_number: "cm-12345" },
      ])
    ).toBe(true);
  });

  it("findLatestDemandLetterFiling picks the most recently created filing regardless of confirmation state", () => {
    const older = {
      id: "fil-dl-older",
      user_id: "user",
      case_id: CASE_ID,
      destination: "Small claims / demand letter",
      filed_at: "2026-06-01",
      confirmation_number: "re_bounced",
      filing_url: null,
      notes: null,
      created_at: "2026-06-01T00:00:00.000Z",
      updated_at: "2026-06-01T00:00:00.000Z",
    };
    const newer = {
      ...older,
      id: "fil-dl-newer",
      confirmation_number: "DL-REMEDIATED",
      created_at: "2026-06-21T00:00:00.000Z",
      updated_at: "2026-06-21T00:00:00.000Z",
    };
    expect(findLatestDemandLetterFiling([older, newer])?.id).toBe("fil-dl-newer");
    expect(findLatestDemandLetterFiling([newer, older])?.id).toBe("fil-dl-newer");
    expect(findLatestDemandLetterFiling([])).toBeUndefined();
  });

  it("builds notes with case id, company, and draft only", () => {
    const notes = buildDemandLetterFilingTaskNotes(CASE_ID, baseIntake());
    expect(notes.startsWith(`demand_letter_filing_queue:${CASE_ID}\n`)).toBe(true);
    expect(notes).toContain(`case_id: ${CASE_ID}`);
    expect(notes).toContain("company: Acme Retail");
    expect(notes).toContain("draft:");
    expect(notes).toContain("DRAFT DEMAND LETTER");
    expect(notes).toContain("Double charge on widget order.");
  });

  it("matches marker-only and structured notes", () => {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    expect(taskNotesMatchDemandLetterFilingMarker(marker, CASE_ID)).toBe(true);
    expect(taskNotesMatchDemandLetterFilingMarker(`${marker}\ncase_id: ${CASE_ID}`, CASE_ID)).toBe(
      true
    );
    expect(taskNotesMatchDemandLetterFilingMarker("other task", CASE_ID)).toBe(false);
  });

  it("parses draft body from task notes", () => {
    const notes = buildDemandLetterFilingTaskNotes(CASE_ID, baseIntake());
    const draft = parseDemandLetterFilingTaskDraft(notes);
    expect(draft).toContain("DRAFT DEMAND LETTER");
    expect(draft).toContain("Acme Retail");
  });

  it("finds open demand letter filing task", () => {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    const tasks: JusticeCaseTaskRow[] = [
      {
        id: "task-dl-1",
        user_id: "user",
        case_id: CASE_ID,
        title: "Demand letter: Acme Retail",
        due_date: null,
        notes: `${marker}\ncase_id: ${CASE_ID}`,
        completed_at: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      },
    ];
    expect(findOpenDemandLetterFilingTask(tasks, CASE_ID)?.id).toBe("task-dl-1");
    expect(
      findOpenDemandLetterFilingTask(
        [{ ...tasks[0]!, completed_at: "2026-01-02T00:00:00.000Z" }],
        CASE_ID
      )
    ).toBeUndefined();
  });

  it("shouldQueueDemandLetterFilingTask when packet approved and next action is demand letter", () => {
    expect(
      shouldQueueDemandLetterFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "approved",
        },
      })
    ).toBe(true);
    expect(
      shouldQueueDemandLetterFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "State Attorney General (consumer)",
          href: "/justice/state-ag",
          status: "approved",
        },
      })
    ).toBe(false);
    expect(
      shouldQueueDemandLetterFilingTask({
        prepared_packet_approved: false,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "approved",
        },
      })
    ).toBe(false);
  });
});

describe("reopenDemandLetterFilingTaskForBounce", () => {
  const USER_ID = "user-dl-bounce";

  function makeCompletedTask(): JusticeCaseTaskRow {
    const marker = demandLetterFilingTaskNotesMarker(CASE_ID);
    return {
      id: "task-dl-bounce",
      user_id: USER_ID,
      case_id: CASE_ID,
      title: "Demand letter: Acme Retail",
      due_date: null,
      notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nDRAFT DEMAND LETTER...`,
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

    const result = await reopenDemandLetterFilingTaskForBounce(supabase, USER_ID, CASE_ID, "bounced");

    expect(result.reopened).toBe(true);
    expect(result.task?.completed_at).toBeNull();
    expect(result.task?.title).toBe("[Needs manual follow-up — bounced] Demand letter: Acme Retail");
    expect(result.timeline).toHaveLength(1);
    expect(result.timeline?.[0]?.label).toBe("Demand letter task reopened for manual follow-up");
  });

  it("uses a distinct title prefix for a spam complaint", async () => {
    const supabase = makeSupabase(makeCompletedTask());

    const result = await reopenDemandLetterFilingTaskForBounce(
      supabase,
      USER_ID,
      CASE_ID,
      "complained"
    );

    expect(result.task?.title).toBe(
      "[Needs manual follow-up — marked as spam] Demand letter: Acme Retail"
    );
  });

  it("does not double-prefix a title that was already reopened for a prior bounce", async () => {
    const task = makeCompletedTask();
    task.title = "[Needs manual follow-up — bounced] Demand letter: Acme Retail";
    const supabase = makeSupabase(task);

    const result = await reopenDemandLetterFilingTaskForBounce(
      supabase,
      USER_ID,
      CASE_ID,
      "complained"
    );

    expect(result.task?.title).toBe(
      "[Needs manual follow-up — marked as spam] Demand letter: Acme Retail"
    );
  });

  it("is a no-op (not reopened) when no matching task exists for the case", async () => {
    const supabase = makeSupabase(null);

    const result = await reopenDemandLetterFilingTaskForBounce(supabase, USER_ID, CASE_ID, "bounced");

    expect(result).toEqual({ task: null, timeline: null, reopened: false });
  });
});

describe("findLatestDemandLetterFilingCreatedAt", () => {
  const USER_ID = "user-dl-latest";

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

  function demandLetterFiling(id: string, createdAt: string): JusticeCaseFilingRow {
    return {
      id,
      user_id: USER_ID,
      case_id: CASE_ID,
      destination: "Small claims / demand letter",
      filed_at: createdAt.slice(0, 10),
      confirmation_number: `conf-${id}`,
      filing_url: null,
      notes: null,
      created_at: createdAt,
      updated_at: createdAt,
    };
  }

  it("returns the created_at of the most recently created demand-letter filing", async () => {
    const supabase = makeFilingsSupabase([
      demandLetterFiling("fil-1", "2026-06-01T00:00:00.000Z"),
      demandLetterFiling("fil-2", "2026-06-21T00:00:00.000Z"),
    ]);

    await expect(findLatestDemandLetterFilingCreatedAt(supabase, USER_ID, CASE_ID)).resolves.toBe(
      "2026-06-21T00:00:00.000Z"
    );
  });

  it("returns null when no demand-letter filing exists yet", async () => {
    const supabase = makeFilingsSupabase([]);

    await expect(findLatestDemandLetterFilingCreatedAt(supabase, USER_ID, CASE_ID)).resolves.toBeNull();
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

    await expect(findLatestDemandLetterFilingCreatedAt(supabase, USER_ID, CASE_ID)).resolves.toBe("error");
  });
});
