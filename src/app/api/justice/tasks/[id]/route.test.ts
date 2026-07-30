import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mockTaskSelectMaybeSingle = vi.fn();
const mockTaskUpdateMaybeSingle = vi.fn();
const mockTaskDeleteSelect = vi.fn();

vi.mock("@/server/requireUser", () => ({
  getUserOr401: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({
    from: (table: string) => {
      if (table !== "justice_case_tasks") {
        throw new Error(`Unexpected table: ${table}`);
      }
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: mockTaskSelectMaybeSingle,
            }),
          }),
        }),
        update: () => ({
          eq: () => ({
            eq: () => ({
              select: () => ({
                maybeSingle: mockTaskUpdateMaybeSingle,
              }),
            }),
          }),
        }),
        delete: () => ({
          eq: () => ({
            eq: () => ({
              select: mockTaskDeleteSelect,
            }),
          }),
        }),
      };
    },
  })),
}));

import { DELETE, PATCH } from "@/app/api/justice/tasks/[id]/route";
import { getUserOr401 } from "@/server/requireUser";
import { bbbFilingTaskNotesMarker } from "@/lib/justice/bbbFilingTask";

const USER_ID = "user_test_123";
const TASK_ID = "550e8400-e29b-41d4-a716-446655440000";
const CASE_ID = "550e8400-e29b-41d4-a716-446655440001";

function reminderTaskRow() {
  return {
    id: TASK_ID,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "Call back merchant next week",
    due_date: null,
    notes: "Follow up personally",
    completed_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  };
}

function managedTaskRow() {
  const marker = bbbFilingTaskNotesMarker(CASE_ID);
  return {
    id: TASK_ID,
    user_id: USER_ID,
    case_id: CASE_ID,
    title: "BBB filing: Acme Retail",
    due_date: null,
    notes: `${marker}\ncase_id: ${CASE_ID}\ndraft:\nComplaint text`,
    completed_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
  };
}

function buildRequest(method: "PATCH" | "DELETE", body?: Record<string, unknown>) {
  return new NextRequest(`http://localhost/api/justice/tasks/${TASK_ID}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function routeContext() {
  return { params: Promise.resolve({ id: TASK_ID }) };
}

describe("PATCH/DELETE /api/justice/tasks/[id] managed-task protection", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-role-key");
    vi.mocked(getUserOr401).mockReturnValue(USER_ID);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("allows PATCH on a legitimate user reminder task", async () => {
    mockTaskSelectMaybeSingle.mockResolvedValue({ data: reminderTaskRow(), error: null });
    mockTaskUpdateMaybeSingle.mockResolvedValue({
      data: { ...reminderTaskRow(), title: "Updated reminder" },
      error: null,
    });

    const res = await PATCH(buildRequest("PATCH", { title: "Updated reminder" }), routeContext());

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.title).toBe("Updated reminder");
  });

  it("rejects PATCH on a Surrenderless-managed operator-fulfillment task", async () => {
    mockTaskSelectMaybeSingle.mockResolvedValue({ data: managedTaskRow(), error: null });

    const res = await PATCH(
      buildRequest("PATCH", { completed_at: "2026-07-15T00:00:00.000Z" }),
      routeContext()
    );

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/managed by Surrenderless/i);
    expect(mockTaskUpdateMaybeSingle).not.toHaveBeenCalled();
  });

  it("allows DELETE on a legitimate user reminder task", async () => {
    mockTaskSelectMaybeSingle.mockResolvedValue({ data: reminderTaskRow(), error: null });
    mockTaskDeleteSelect.mockResolvedValue({ data: [{ id: TASK_ID }], error: null });

    const res = await DELETE(buildRequest("DELETE"), routeContext());

    expect(res.status).toBe(200);
    expect(mockTaskDeleteSelect).toHaveBeenCalled();
  });

  it("rejects DELETE on a Surrenderless-managed operator-fulfillment task — this is exactly the case-stranding vector", async () => {
    // Deleting an open BBB filing task would silently drop it from the operator queue
    // while chat still tells the consumer to wait — the operator never files it.
    mockTaskSelectMaybeSingle.mockResolvedValue({ data: managedTaskRow(), error: null });

    const res = await DELETE(buildRequest("DELETE"), routeContext());

    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toMatch(/managed by Surrenderless/i);
    expect(mockTaskDeleteSelect).not.toHaveBeenCalled();
  });
});
