import { describe, expect, it } from "vitest";
import { buildChatConfirmedFilingSummaryLines } from "@/lib/justice/chatConfirmedFilingsSummary";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";
const USER_ID = "user-owner-1";

function baseFiling(overrides: Partial<JusticeCaseFilingRow> = {}): JusticeCaseFilingRow {
  return {
    id: "filing-1",
    user_id: USER_ID,
    case_id: CASE_ID,
    destination: "Better Business Bureau",
    filed_at: "2026-06-15",
    confirmation_number: "BBB-998877",
    filing_url: null,
    notes: null,
    created_at: "2026-06-15T00:00:00.000Z",
    updated_at: "2026-06-15T00:00:00.000Z",
    ...overrides,
  };
}

describe("buildChatConfirmedFilingSummaryLines", () => {
  it("maps a confirmed filing to destination, filed date, and the complete confirmation number", () => {
    const lines = buildChatConfirmedFilingSummaryLines([baseFiling()]);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toEqual({
      id: "filing-1",
      destination: "Better Business Bureau",
      filedAtLabel: expect.stringContaining("2026"),
      confirmationNumber: "BBB-998877",
    });
  });

  it("never truncates the confirmation number, however long", () => {
    const longConfirmation = "CONF-" + "9".repeat(80);
    const lines = buildChatConfirmedFilingSummaryLines([
      baseFiling({ confirmation_number: longConfirmation }),
    ]);

    expect(lines[0].confirmationNumber).toBe(longConfirmation);
  });

  it("excludes filings with no confirmation number on file", () => {
    const lines = buildChatConfirmedFilingSummaryLines([
      baseFiling({ id: "unconfirmed", confirmation_number: null }),
      baseFiling({ id: "blank", confirmation_number: "   " }),
    ]);

    expect(lines).toEqual([]);
  });

  it("handles a missing filed_at cleanly (no date label, still shows the confirmation)", () => {
    const lines = buildChatConfirmedFilingSummaryLines([baseFiling({ filed_at: null })]);

    expect(lines).toHaveLength(1);
    expect(lines[0].filedAtLabel).toBeNull();
    expect(lines[0].confirmationNumber).toBe("BBB-998877");
  });

  it("handles an unparseable filed_at cleanly by omitting the date rather than showing garbage", () => {
    const lines = buildChatConfirmedFilingSummaryLines([
      baseFiling({ filed_at: "not-a-real-date" }),
    ]);

    expect(lines[0].filedAtLabel).toBeNull();
  });

  it("falls back to a generic label when destination is missing or blank", () => {
    const lines = buildChatConfirmedFilingSummaryLines([baseFiling({ destination: "   " })]);

    expect(lines[0].destination).toBe("Filing");
  });

  it("returns multiple confirmed filings in the given order, skipping unconfirmed ones between them", () => {
    const lines = buildChatConfirmedFilingSummaryLines([
      baseFiling({ id: "first", destination: "Better Business Bureau", confirmation_number: "BBB-1" }),
      baseFiling({ id: "unconfirmed", confirmation_number: null }),
      baseFiling({
        id: "second",
        destination: "Small claims / demand letter",
        confirmation_number: "DL-2",
      }),
    ]);

    expect(lines.map((l) => l.id)).toEqual(["first", "second"]);
  });
});
