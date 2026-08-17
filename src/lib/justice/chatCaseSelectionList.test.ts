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
    // Unquoted "company name" instruction is retired — the list must teach the quoted form.
    expect(message).toMatch(/exact case name in quotes/i);
    expect(message).toContain('open "Acme Retail"');
  });

  it("resolves selection by number or an exact, unique company name", () => {
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

  // This is the final gate before a real session switch or archive restore: no substring or
  // fuzzy match may ever succeed here, regardless of how the parser upstream extracted the query.
  describe("exact, unique match only — no substring or fuzzy match may switch or restore a case", () => {
    it("a partial name ('Acme') cannot select the full company name ('Acme Retail')", () => {
      const entries = buildChatCaseSelectionList({
        activeRows: [{ id: ACTIVE_ID, intake: VALID_INTAKE, archived_at: null }],
        archivedRows: [],
      });
      expect(resolveChatCaseSelectionChoice("Acme", entries)).toEqual({ kind: "none" });
      expect(resolveChatCaseSelectionChoice("Acme Retail Corp", entries)).toEqual({
        kind: "none",
      });
    });

    it("duplicate exact company names cannot select — fails closed as ambiguous, not a guess", () => {
      const secondActiveId = "550e8400-e29b-41d4-a716-446655440003";
      const entries = buildChatCaseSelectionList({
        activeRows: [
          { id: ACTIVE_ID, intake: VALID_INTAKE, archived_at: null },
          { id: secondActiveId, intake: VALID_INTAKE, archived_at: null },
        ],
        archivedRows: [],
      });
      expect(entries).toHaveLength(2);
      expect(resolveChatCaseSelectionChoice("Acme Retail", entries)).toEqual({
        kind: "ambiguous",
      });
    });

    it("an exact, unique quoted name resolves to the one real match", () => {
      const entries = buildChatCaseSelectionList({
        activeRows: [{ id: ACTIVE_ID, intake: BETA_INTAKE, archived_at: null }],
        archivedRows: [{ id: ARCHIVED_ID, intake: VALID_INTAKE, archived_at: "2026-06-23T12:00:00.000Z" }],
      });
      expect(resolveChatCaseSelectionChoice("Acme Retail", entries)).toEqual({
        kind: "match",
        entry: entries[1],
      });
      expect(resolveChatCaseSelectionChoice("Beta Corp", entries)).toEqual({
        kind: "match",
        entry: entries[0],
      });
    });

    it("a garbage/filler query never accidentally matches a real single-case account", () => {
      // The single-case account is the highest-risk scenario for a substring/fuzzy matcher: with
      // only one entry, a loose match against "any" or "-" could silently succeed. Exact matching
      // makes this structurally impossible without a case literally named that.
      const entries = buildChatCaseSelectionList({
        activeRows: [{ id: ACTIVE_ID, intake: VALID_INTAKE, archived_at: null }],
        archivedRows: [],
      });
      for (const query of ["any", "other", "the", "my", "a", "-", "a different"]) {
        expect(resolveChatCaseSelectionChoice(query, entries)).toEqual({ kind: "none" });
      }
    });
  });

  // A custom case_label is a real, user-set feature and takes display priority over the company
  // name (formatChatCaseSelectionListMessage shows caseLabel || companyName as the title) — so
  // resolution must match the SAME displayed title, not the company name underneath it.
  describe("custom case_label — matches the displayed title, never the company name as a fallback", () => {
    const AMAZON_INTAKE = {
      ...VALID_INTAKE,
      company_name: "Amazon",
      purchase_or_signup: "widget order",
    };

    it('"My February Return" selects the labeled Amazon case', () => {
      const entries = buildChatCaseSelectionList({
        activeRows: [
          {
            id: ACTIVE_ID,
            intake: AMAZON_INTAKE,
            archived_at: null,
            case_label: "My February Return",
          },
        ],
        archivedRows: [],
      });
      expect(entries[0]).toMatchObject({ companyName: "Amazon", caseLabel: "My February Return" });

      const message = formatChatCaseSelectionListMessage(entries);
      expect(message).toContain("1. My February Return (widget order) — active");

      expect(resolveChatCaseSelectionChoice("My February Return", entries)).toEqual({
        kind: "match",
        entry: entries[0],
      });
    });

    it('"Amazon" (the company name) cannot select the case by fallback once a label is set', () => {
      const entries = buildChatCaseSelectionList({
        activeRows: [
          {
            id: ACTIVE_ID,
            intake: AMAZON_INTAKE,
            archived_at: null,
            case_label: "My February Return",
          },
        ],
        archivedRows: [],
      });
      expect(resolveChatCaseSelectionChoice("Amazon", entries)).toEqual({ kind: "none" });
    });

    it("no partial matching against the label — a substring of the displayed title fails closed", () => {
      const entries = buildChatCaseSelectionList({
        activeRows: [
          {
            id: ACTIVE_ID,
            intake: AMAZON_INTAKE,
            archived_at: null,
            case_label: "My February Return",
          },
        ],
        archivedRows: [],
      });
      for (const query of ["February", "February Return", "My February", "Return"]) {
        expect(resolveChatCaseSelectionChoice(query, entries)).toEqual({ kind: "none" });
      }
    });

    it("duplicate displayed labels fail closed as ambiguous, not a guess", () => {
      const secondActiveId = "550e8400-e29b-41d4-a716-446655440004";
      const entries = buildChatCaseSelectionList({
        activeRows: [
          {
            id: ACTIVE_ID,
            intake: AMAZON_INTAKE,
            archived_at: null,
            case_label: "My February Return",
          },
          {
            id: secondActiveId,
            intake: BETA_INTAKE,
            archived_at: null,
            case_label: "My February Return",
          },
        ],
        archivedRows: [],
      });
      expect(entries).toHaveLength(2);
      expect(resolveChatCaseSelectionChoice("My February Return", entries)).toEqual({
        kind: "ambiguous",
      });
    });

    it("cases without a label are unaffected — company name still resolves directly", () => {
      const entries = buildChatCaseSelectionList({
        activeRows: [{ id: ACTIVE_ID, intake: AMAZON_INTAKE, archived_at: null }],
        archivedRows: [],
      });
      expect(entries[0]?.caseLabel).toBeNull();
      expect(resolveChatCaseSelectionChoice("Amazon", entries)).toEqual({
        kind: "match",
        entry: entries[0],
      });
    });
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
