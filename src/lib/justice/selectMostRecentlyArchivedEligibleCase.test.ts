import { describe, expect, it } from "vitest";
import {
  canRestoreArchivedCaseRow,
  isEligibleArchivedCaseListRow,
  selectMostRecentlyArchivedEligibleCase,
} from "@/lib/justice/selectMostRecentlyArchivedEligibleCase";

const VALID_INTAKE = {
  problem_category: "online_purchase",
  company_name: "Acme Retail",
  company_website: "https://acme.example",
  purchase_or_signup: "widget order",
  story: "Double charge",
  money_involved: "yes",
  pay_or_order_date: "2026-01-01",
  order_confirmation_details: "ORD-1",
  user_display_name: "Jordan Lee",
  reply_email: "e2e-chat@example.com",
  already_contacted: "yes",
};

describe("selectMostRecentlyArchivedEligibleCase", () => {
  it("returns the first eligible row when list is already ordered by updated_at DESC", () => {
    const selected = selectMostRecentlyArchivedEligibleCase([
      {
        id: "case-newest",
        archived_at: "2026-06-23T12:00:00.000Z",
        updated_at: "2026-06-23T12:05:00.000Z",
        intake: VALID_INTAKE,
      },
      {
        id: "case-older",
        archived_at: "2026-06-22T12:00:00.000Z",
        updated_at: "2026-06-22T12:05:00.000Z",
        intake: VALID_INTAKE,
      },
    ]);

    expect(selected?.id).toBe("case-newest");
  });

  it("skips rows without archived_at or valid intake", () => {
    const selected = selectMostRecentlyArchivedEligibleCase([
      { id: "bad-intake", archived_at: "2026-06-23T12:00:00.000Z", intake: { company_name: "x" } },
      {
        id: "good",
        archived_at: "2026-06-22T12:00:00.000Z",
        intake: VALID_INTAKE,
      },
    ]);

    expect(selected?.id).toBe("good");
  });

  it("returns the first eligible row after skipping ineligible entries", () => {
    const selected = selectMostRecentlyArchivedEligibleCase([
      { id: "skip", archived_at: null, intake: VALID_INTAKE },
      {
        id: "older",
        archived_at: "2026-06-21T12:00:00.000Z",
        updated_at: "2026-06-21T12:05:00.000Z",
        intake: VALID_INTAKE,
      },
      {
        id: "newer",
        archived_at: "2026-06-23T12:00:00.000Z",
        updated_at: "2026-06-20T12:05:00.000Z",
        intake: VALID_INTAKE,
      },
    ]);

    expect(selected?.id).toBe("older");
  });

  it("returns null when no eligible archived rows exist", () => {
    expect(selectMostRecentlyArchivedEligibleCase([])).toBeNull();
    expect(
      selectMostRecentlyArchivedEligibleCase([
        { id: "active", archived_at: null, intake: VALID_INTAKE },
      ])
    ).toBeNull();
  });
});

describe("isEligibleArchivedCaseListRow", () => {
  it("requires archived_at and valid intake", () => {
    expect(
      isEligibleArchivedCaseListRow({
        id: "case-1",
        archived_at: "2026-06-23T12:00:00.000Z",
        intake: VALID_INTAKE,
      })
    ).toBe(true);
    expect(
      isEligibleArchivedCaseListRow({
        id: "case-1",
        archived_at: null,
        intake: VALID_INTAKE,
      })
    ).toBe(false);
  });
});

describe("canRestoreArchivedCaseRow", () => {
  it("allows restore only when archived_at is set", () => {
    expect(canRestoreArchivedCaseRow({ archived_at: "2026-06-23T12:00:00.000Z" })).toBe(true);
    expect(canRestoreArchivedCaseRow({ archived_at: null })).toBe(false);
    expect(canRestoreArchivedCaseRow({})).toBe(false);
  });
});
