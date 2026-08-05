import { describe, expect, it } from "vitest";
import { MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";
import {
  buildSupersededLaneReviewCompletionRequest,
  selectOpenSupersededLaneReviewTasks,
} from "@/lib/justice/supersededLaneReviewChatPrompt";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CASE_ID = "22222222-2222-4222-8222-222222222222";

function supersededTask(overrides: Partial<JusticeCaseTaskRow> = {}): JusticeCaseTaskRow {
  const id = overrides.id ?? "task-1";
  const caseId = overrides.case_id ?? CASE_ID;
  return {
    id,
    user_id: "owner-1",
    case_id: caseId,
    title: "Follow-up response review: Small claims / demand letter",
    due_date: null,
    notes: [
      `superseded_lane_review:${caseId}`,
      `owner_href:${MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF}`,
      "follow_up_task_id:linked-follow-up",
      `case_id: ${caseId}`,
      "guidance:",
      "Review this lane independently.",
    ].join("\n"),
    completed_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("selectOpenSupersededLaneReviewTasks", () => {
  it("returns a single open review task", () => {
    const task = supersededTask();
    expect(selectOpenSupersededLaneReviewTasks([task], CASE_ID)).toEqual([task]);
  });

  it("returns every open review task when multiple are open at once", () => {
    const taskA = supersededTask({ id: "task-a" });
    const taskB = supersededTask({ id: "task-b" });
    const taskC = supersededTask({ id: "task-c" });
    const result = selectOpenSupersededLaneReviewTasks([taskA, taskB, taskC], CASE_ID);
    expect(result.map((t) => t.id).sort()).toEqual(["task-a", "task-b", "task-c"]);
  });

  it("sorts the deep-linked task first among multiple open reviews (exact-task visibility)", () => {
    const taskA = supersededTask({ id: "task-a" });
    const taskB = supersededTask({ id: "task-b" });
    const taskC = supersededTask({ id: "task-c" });
    const result = selectOpenSupersededLaneReviewTasks([taskA, taskB, taskC], CASE_ID, "task-c");
    expect(result[0].id).toBe("task-c");
    expect(result.map((t) => t.id).sort()).toEqual(["task-a", "task-b", "task-c"]);
  });

  it("still returns all open tasks (unsorted) when the deep-linked id matches none of them", () => {
    const taskA = supersededTask({ id: "task-a" });
    const taskB = supersededTask({ id: "task-b" });
    const result = selectOpenSupersededLaneReviewTasks([taskA, taskB], CASE_ID, "no-such-task");
    expect(result.map((t) => t.id).sort()).toEqual(["task-a", "task-b"]);
  });

  it("excludes a completed task", () => {
    const open = supersededTask({ id: "task-open" });
    const done = supersededTask({ id: "task-done", completed_at: "2026-07-02T00:00:00.000Z" });
    const result = selectOpenSupersededLaneReviewTasks([open, done], CASE_ID);
    expect(result.map((t) => t.id)).toEqual(["task-open"]);
  });

  it("excludes a task belonging to a different case", () => {
    const mine = supersededTask({ id: "task-mine" });
    const other = supersededTask({ id: "task-other", case_id: OTHER_CASE_ID });
    const result = selectOpenSupersededLaneReviewTasks([mine, other], CASE_ID);
    expect(result.map((t) => t.id)).toEqual(["task-mine"]);
  });

  it("excludes a task whose notes don't match the superseded_lane_review marker", () => {
    const mismatched = supersededTask({ id: "task-x", notes: "unrelated task notes" });
    expect(selectOpenSupersededLaneReviewTasks([mismatched], CASE_ID)).toEqual([]);
  });

  it("returns an empty list when there are no open reviews at all", () => {
    expect(selectOpenSupersededLaneReviewTasks([], CASE_ID)).toEqual([]);
  });
});

describe("buildSupersededLaneReviewCompletionRequest", () => {
  it("builds a request for the response_received action", () => {
    const req = buildSupersededLaneReviewCompletionRequest(
      CASE_ID,
      supersededTask(),
      "response_received"
    );
    expect(req).toEqual({
      case_id: CASE_ID,
      task_id: "task-1",
      owner_href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
      outcome: "response_received",
    });
  });

  it("builds a request for the no_response action", () => {
    const req = buildSupersededLaneReviewCompletionRequest(
      CASE_ID,
      supersededTask(),
      "no_response"
    );
    expect(req).toEqual({
      case_id: CASE_ID,
      task_id: "task-1",
      owner_href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
      outcome: "no_response",
    });
  });

  it("returns null when the case id is not a valid uuid", () => {
    expect(
      buildSupersededLaneReviewCompletionRequest("not-a-uuid", supersededTask(), "no_response")
    ).toBeNull();
  });

  it("returns null when the task has no owner_href line (malformed/completed-shaped notes)", () => {
    const task = supersededTask({ notes: `superseded_lane_review:${CASE_ID}\ncase_id: ${CASE_ID}` });
    expect(
      buildSupersededLaneReviewCompletionRequest(CASE_ID, task, "response_received")
    ).toBeNull();
  });

  it("returns null when the task id is empty", () => {
    const task = supersededTask({ id: "" });
    expect(
      buildSupersededLaneReviewCompletionRequest(CASE_ID, task, "response_received")
    ).toBeNull();
  });
});
