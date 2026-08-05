import { describe, expect, it } from "vitest";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import {
  isOpenConsumerReviewTaskForDeepLink,
  parseReviewTaskDeepLinkParams,
  resolveReviewTaskDeepLinkAction,
} from "@/lib/justice/resolveReviewTaskDeepLink";

const CASE_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CASE_ID = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "33333333-3333-4333-8333-333333333333";

function followUpTask(overrides: Partial<JusticeCaseTaskRow> = {}): JusticeCaseTaskRow {
  return {
    id: TASK_ID,
    user_id: "owner-1",
    case_id: CASE_ID,
    title: "Follow-up response review: Acme",
    due_date: null,
    notes: `follow_up_response_review:${CASE_ID}\ncase_id: ${CASE_ID}\nguidance:\nReview`,
    completed_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function supersededTask(overrides: Partial<JusticeCaseTaskRow> = {}): JusticeCaseTaskRow {
  return {
    id: TASK_ID,
    user_id: "owner-1",
    case_id: CASE_ID,
    title: "Follow-up response review: Small claims / demand letter",
    due_date: null,
    notes: [
      `superseded_lane_review:${CASE_ID}`,
      "owner_href:/justice/handling?tab=demand-letter",
      "follow_up_task_id:linked-follow-up",
      `case_id: ${CASE_ID}`,
      "guidance:",
      "Review this lane independently.",
    ].join("\n"),
    completed_at: null,
    created_at: "2026-07-01T00:00:00.000Z",
    updated_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("parseReviewTaskDeepLinkParams", () => {
  it("parses valid case + task uuid params", () => {
    expect(parseReviewTaskDeepLinkParams(`?case=${CASE_ID}&task=${TASK_ID}`)).toEqual({
      caseId: CASE_ID,
      taskId: TASK_ID,
    });
  });

  it("returns null when there are no params at all", () => {
    expect(parseReviewTaskDeepLinkParams("")).toBeNull();
  });

  it("returns null when case is missing", () => {
    expect(parseReviewTaskDeepLinkParams(`?task=${TASK_ID}`)).toBeNull();
  });

  it("returns null when task is missing", () => {
    expect(parseReviewTaskDeepLinkParams(`?case=${CASE_ID}`)).toBeNull();
  });

  it("returns null for a non-uuid case id", () => {
    expect(parseReviewTaskDeepLinkParams(`?case=not-a-uuid&task=${TASK_ID}`)).toBeNull();
  });

  it("returns null for a non-uuid task id", () => {
    expect(parseReviewTaskDeepLinkParams(`?case=${CASE_ID}&task=not-a-uuid`)).toBeNull();
  });

  it("returns null for blank/whitespace-only params", () => {
    expect(parseReviewTaskDeepLinkParams("?case=%20&task=%20")).toBeNull();
  });
});

describe("isOpenConsumerReviewTaskForDeepLink", () => {
  it("accepts an open follow_up_response_review task", () => {
    expect(isOpenConsumerReviewTaskForDeepLink(followUpTask(), CASE_ID)).toBe(true);
  });

  it("accepts an open superseded_lane_review task", () => {
    expect(isOpenConsumerReviewTaskForDeepLink(supersededTask(), CASE_ID)).toBe(true);
  });

  it("rejects a completed task", () => {
    const task = followUpTask({ completed_at: "2026-07-02T00:00:00.000Z" });
    expect(isOpenConsumerReviewTaskForDeepLink(task, CASE_ID)).toBe(false);
  });

  it("rejects a task belonging to a different case", () => {
    const task = followUpTask({ case_id: OTHER_CASE_ID });
    expect(isOpenConsumerReviewTaskForDeepLink(task, CASE_ID)).toBe(false);
  });

  it("rejects a task whose notes don't match either review marker", () => {
    const task = followUpTask({ notes: "some unrelated task notes" });
    expect(isOpenConsumerReviewTaskForDeepLink(task, CASE_ID)).toBe(false);
  });

  it("rejects a null/missing task", () => {
    expect(isOpenConsumerReviewTaskForDeepLink(null, CASE_ID)).toBe(false);
    expect(isOpenConsumerReviewTaskForDeepLink(undefined, CASE_ID)).toBe(false);
  });
});

describe("resolveReviewTaskDeepLinkAction", () => {
  it("does nothing when no deep-link params are present (normal chat preserved)", () => {
    const action = resolveReviewTaskDeepLinkAction({
      search: "",
      sessionCaseId: "",
      caseLookup: null,
      tasks: null,
    });
    expect(action).toEqual({ kind: "none" });
  });

  it("hydrates the exact linked case + follow_up_response_review task on a fresh (empty) session", () => {
    const action = resolveReviewTaskDeepLinkAction({
      search: `?case=${CASE_ID}&task=${TASK_ID}`,
      sessionCaseId: "",
      caseLookup: { id: CASE_ID },
      tasks: [followUpTask()],
    });
    expect(action).toEqual({ kind: "hydrate", caseId: CASE_ID, taskId: TASK_ID });
  });

  it("hydrates the exact linked case + superseded_lane_review task on a fresh (empty) session", () => {
    const action = resolveReviewTaskDeepLinkAction({
      search: `?case=${CASE_ID}&task=${TASK_ID}`,
      sessionCaseId: "",
      caseLookup: { id: CASE_ID },
      tasks: [supersededTask()],
    });
    expect(action).toEqual({ kind: "hydrate", caseId: CASE_ID, taskId: TASK_ID });
  });

  it("hydrates the exact linked case when the session holds a DIFFERENT case (never substitutes it)", () => {
    const action = resolveReviewTaskDeepLinkAction({
      search: `?case=${CASE_ID}&task=${TASK_ID}`,
      sessionCaseId: OTHER_CASE_ID,
      caseLookup: { id: CASE_ID },
      tasks: [followUpTask()],
    });
    expect(action).toEqual({ kind: "hydrate", caseId: CASE_ID, taskId: TASK_ID });
  });

  it("is a no-op when the session already has the exact linked case active (no redundant reload)", () => {
    const action = resolveReviewTaskDeepLinkAction({
      search: `?case=${CASE_ID}&task=${TASK_ID}`,
      sessionCaseId: CASE_ID,
      caseLookup: { id: CASE_ID },
      tasks: [followUpTask()],
    });
    expect(action).toEqual({ kind: "none" });
  });

  it("rejects when the case lookup is null (unauthorized or nonexistent case) without leaking which", () => {
    const action = resolveReviewTaskDeepLinkAction({
      search: `?case=${CASE_ID}&task=${TASK_ID}`,
      sessionCaseId: "",
      caseLookup: null,
      tasks: null,
    });
    expect(action).toEqual({ kind: "reject" });
  });

  it("rejects when the case lookup resolves to a different case id than the link", () => {
    const action = resolveReviewTaskDeepLinkAction({
      search: `?case=${CASE_ID}&task=${TASK_ID}`,
      sessionCaseId: "",
      caseLookup: { id: OTHER_CASE_ID },
      tasks: [followUpTask()],
    });
    expect(action).toEqual({ kind: "reject" });
  });

  it("is a no-op for a malformed link (non-uuid task), same as no link at all", () => {
    const action = resolveReviewTaskDeepLinkAction({
      search: `?case=${CASE_ID}&task=not-a-uuid`,
      sessionCaseId: "",
      caseLookup: { id: CASE_ID },
      tasks: [followUpTask()],
    });
    expect(action).toEqual({ kind: "none" });
  });

  it("rejects when the linked task is already completed", () => {
    const action = resolveReviewTaskDeepLinkAction({
      search: `?case=${CASE_ID}&task=${TASK_ID}`,
      sessionCaseId: "",
      caseLookup: { id: CASE_ID },
      tasks: [followUpTask({ completed_at: "2026-07-02T00:00:00.000Z" })],
    });
    expect(action).toEqual({ kind: "reject" });
  });

  it("rejects when the task id in the link isn't in the case's own task list (cross-case task)", () => {
    const action = resolveReviewTaskDeepLinkAction({
      search: `?case=${CASE_ID}&task=${TASK_ID}`,
      sessionCaseId: "",
      caseLookup: { id: CASE_ID },
      tasks: [followUpTask({ id: "some-other-task-id" })],
    });
    expect(action).toEqual({ kind: "reject" });
  });

  it("rejects when the tasks fetch itself failed (tasks null) even though the case lookup succeeded", () => {
    const action = resolveReviewTaskDeepLinkAction({
      search: `?case=${CASE_ID}&task=${TASK_ID}`,
      sessionCaseId: "",
      caseLookup: { id: CASE_ID },
      tasks: null,
    });
    expect(action).toEqual({ kind: "reject" });
  });
});
