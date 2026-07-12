import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJusticePreviewDraft } from "@/lib/justice/requestJusticePreviewDraft";
import type { JusticeIntake } from "@/lib/justice/types";

const intake: JusticeIntake = {
  problem_category: "online_purchase",
  company_name: "Acme Retail",
  company_website: "https://acme.example",
  purchase_or_signup: "Widget",
  story: "Bought an item; merchant refused refund.",
  money_involved: "$50",
  pay_or_order_date: "2026-01-15",
  order_confirmation_details: "ORD-1",
  user_display_name: "Test User",
  reply_email: "test@example.com",
  already_contacted: "yes",
};

describe("requestJusticePreviewDraft", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("posts to the production preview-draft API and returns the draft", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ draft: "AI DRAFT TEXT" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await requestJusticePreviewDraft({
      intake,
      destinationId: "bbb",
      destinationLabel: "Better Business Bureau",
      caseId: "550e8400-e29b-41d4-a716-446655440001",
      evidenceItems: [{ title: "Denial", evidence_type: "screenshot" }],
      timeline: [
        {
          id: "t1",
          case_id: "550e8400-e29b-41d4-a716-446655440001",
          type: "evidence_added",
          label: "Evidence added",
          ts: "2026-01-01T00:00:00.000Z",
        },
      ],
    });

    expect(result).toEqual({ ok: true, draft: "AI DRAFT TEXT" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/justice/preview-draft",
      expect.objectContaining({ method: "POST" })
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string) as {
      case_id?: string;
      destination_id?: string;
      evidence_items?: unknown[];
    };
    expect(body.case_id).toBe("550e8400-e29b-41d4-a716-446655440001");
    expect(body.destination_id).toBe("bbb");
    expect(body.evidence_items).toHaveLength(1);
  });

  it("surfaces API errors without throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: "Draft service unavailable." }),
      })
    );

    const result = await requestJusticePreviewDraft({
      intake,
      destinationId: "bbb",
      destinationLabel: "Better Business Bureau",
    });

    expect(result).toEqual({
      ok: false,
      error: "Draft service unavailable.",
      status: 503,
    });
  });
});
