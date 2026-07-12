import { describe, expect, it } from "vitest";
import {
  buildChatCaseSelectionList,
  formatChatCaseSelectionListMessage,
  resolveChatCaseSelectionChoice,
  resolveChatCaseSelectionLiveStatus,
  toChatCaseSelectionListEntry,
} from "@/lib/justice/chatCaseSelectionList";

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

const BETA_INTAKE = {
  ...VALID_INTAKE,
  company_name: "Beta Corp",
  purchase_or_signup: "gadget order",
};

const ACTIVE_ID = "550e8400-e29b-41d4-a716-446655440001";
const ARCHIVED_ID = "550e8400-e29b-41d4-a716-446655440002";

describe("chatCaseSelectionList", () => {
  it("builds active-then-archived numbered entries and formats the chat list", () => {
    const entries = buildChatCaseSelectionList({
      activeRows: [
        {
          id: ACTIVE_ID,
          archived_at: null,
          intake: BETA_INTAKE,
          updated_at: "2026-06-24T12:00:00.000Z",
        },
      ],
      archivedRows: [
        {
          id: ARCHIVED_ID,
          archived_at: "2026-06-23T12:00:00.000Z",
          intake: VALID_INTAKE,
          updated_at: "2026-06-23T12:00:00.000Z",
        },
      ],
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      id: ACTIVE_ID,
      status: "active",
      companyName: "Beta Corp",
    });
    expect(entries[1]).toMatchObject({
      id: ARCHIVED_ID,
      status: "archived",
      companyName: "Acme Retail",
    });

    const message = formatChatCaseSelectionListMessage(entries);
    expect(message).toContain("1. Beta Corp (gadget order) — active");
    expect(message).toContain("2. Acme Retail (widget order) — archived");
  });

  it("resolves selection by number or unique company name", () => {
    const entries = buildChatCaseSelectionList({
      activeRows: [{ id: ACTIVE_ID, intake: BETA_INTAKE, archived_at: null }],
      archivedRows: [{ id: ARCHIVED_ID, intake: VALID_INTAKE, archived_at: "2026-06-23T12:00:00.000Z" }],
    });

    expect(resolveChatCaseSelectionChoice("2", entries)).toEqual({
      kind: "match",
      entry: entries[1],
    });
    expect(resolveChatCaseSelectionChoice("Acme Retail", entries)).toEqual({
      kind: "match",
      entry: entries[1],
    });
    expect(resolveChatCaseSelectionChoice("9", entries)).toEqual({ kind: "none" });
  });

  it("resolves live status from server lists and ignores stale offer status", () => {
    // Offer may still say "active", but refreshed lists show archived → restore path.
    expect(
      resolveChatCaseSelectionLiveStatus({
        caseId: ACTIVE_ID,
        activeRows: [],
        archivedRows: [
          {
            id: ACTIVE_ID,
            intake: BETA_INTAKE,
            archived_at: "2026-06-24T15:00:00.000Z",
          },
        ],
      })
    ).toBe("archived");

    expect(
      resolveChatCaseSelectionLiveStatus({
        caseId: ACTIVE_ID,
        activeRows: [{ id: ACTIVE_ID, intake: BETA_INTAKE, archived_at: null }],
        archivedRows: [],
      })
    ).toBe("active");

    // Active list wins if id appears in both.
    expect(
      resolveChatCaseSelectionLiveStatus({
        caseId: ACTIVE_ID,
        activeRows: [{ id: ACTIVE_ID, intake: BETA_INTAKE, archived_at: null }],
        archivedRows: [
          {
            id: ACTIVE_ID,
            intake: BETA_INTAKE,
            archived_at: "2026-06-24T15:00:00.000Z",
          },
        ],
      })
    ).toBe("active");

    expect(
      resolveChatCaseSelectionLiveStatus({
        caseId: ACTIVE_ID,
        activeRows: [],
        archivedRows: [],
      })
    ).toBeNull();
  });

  it("skips ineligible rows and requires a company name", () => {
    expect(
      toChatCaseSelectionListEntry(
        { id: "not-a-uuid", intake: VALID_INTAKE, archived_at: null },
        "active"
      )
    ).toBeNull();
    expect(
      toChatCaseSelectionListEntry(
        {
          id: ACTIVE_ID,
          intake: { ...VALID_INTAKE, company_name: "   " },
          archived_at: null,
        },
        "active"
      )
    ).toBeNull();
  });
});
