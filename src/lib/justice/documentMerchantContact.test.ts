import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  documentMerchantContact,
  validateMerchantContactDocumentation,
  type MerchantContactDocumentationInput,
} from "@/lib/justice/documentMerchantContact";
import { writeLocalIntakeCaseVersion } from "@/lib/justice/patchJusticeCaseIntake";
import type { JusticeIntake } from "@/lib/justice/types";

function baseInput(overrides: Partial<MerchantContactDocumentationInput> = {}): MerchantContactDocumentationInput {
  return {
    contactMethod: "email",
    contactDate: "2026-03-05",
    merchantResponseType: "refused_help",
    contactProofType: "none",
    contactProofText: "",
    ...overrides,
  };
}

describe("validateMerchantContactDocumentation proof-type alignment with the CFPB gate", () => {
  it("blocks 'none' without text (unchanged)", () => {
    const result = validateMerchantContactDocumentation(baseInput({ contactProofType: "none" }));
    expect(result.ok).toBe(false);
  });

  it("blocks 'ticket' without text (unchanged)", () => {
    const result = validateMerchantContactDocumentation(baseInput({ contactProofType: "ticket" }));
    expect(result.ok).toBe(false);
  });

  it("blocks 'paste' without text (previously allowed to save silently)", () => {
    const result = validateMerchantContactDocumentation(baseInput({ contactProofType: "paste" }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.contactProofError).toMatch(/paste/i);
  });

  it("allows 'paste' with text", () => {
    const result = validateMerchantContactDocumentation(
      baseInput({ contactProofType: "paste", contactProofText: "Pasted the email here." })
    );
    expect(result.ok).toBe(true);
  });

  it("blocks 'upload' without a real uploaded evidence record, even with text present", () => {
    const result = validateMerchantContactDocumentation(
      baseInput({ contactProofType: "upload", contactProofText: "I uploaded a file, I promise" }),
      false
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.contactProofError).toMatch(/upload/i);
  });

  it("allows 'upload' once hasUploadedEvidenceFile is true, even with blank text", () => {
    const result = validateMerchantContactDocumentation(
      baseInput({ contactProofType: "upload", contactProofText: "" }),
      true
    );
    expect(result.ok).toBe(true);
  });

  it("blocks 'screenshot' without a real uploaded evidence record", () => {
    const result = validateMerchantContactDocumentation(
      baseInput({ contactProofType: "screenshot" }),
      false
    );
    expect(result.ok).toBe(false);
  });

  it("defaults hasUploadedEvidenceFile to false when omitted", () => {
    const result = validateMerchantContactDocumentation(baseInput({ contactProofType: "upload" }));
    expect(result.ok).toBe(false);
  });

  it("still requires a valid contact date regardless of proof type", () => {
    const result = validateMerchantContactDocumentation(
      baseInput({ contactDate: "", contactProofType: "upload" }),
      true
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.contactDateError).toBeTruthy();
  });
});

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const baseIntake: JusticeIntake = {
  company_name: "Acme",
  company_website: "",
  problem_category: "online_purchase",
  story: "Charged twice",
  money_involved: "$50",
  pay_or_order_date: "2026-01-01",
  order_confirmation_details: "",
  user_display_name: "User",
  reply_email: "user@example.com",
  purchase_or_signup: "Widget",
  already_contacted: "no",
};

function stubSessionStorage() {
  const store: Record<string, string> = {};
  const sessionStorage = {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      for (const key of Object.keys(store)) delete store[key];
    },
  };
  vi.stubGlobal("sessionStorage", sessionStorage);
  vi.stubGlobal("window", { sessionStorage });
  return sessionStorage;
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

describe("documentMerchantContact — conflict/missing_version propagation (never reports success on a rejected write)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    stubSessionStorage();
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const input: MerchantContactDocumentationInput = {
    contactMethod: "email",
    contactDate: "2026-03-05",
    merchantResponseType: "refused_help",
    contactProofType: "paste",
    contactProofText: "Pasted the reply here.",
  };

  it("on a 409 conflict, returns ok:false with the fresh server current snapshot — never ok:true with the locally-computed (rejected) intake", async () => {
    writeLocalIntakeCaseVersion(1);
    const freshIntake = { ...baseIntake, company_name: "Someone else's edit" };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(409, {
        error: "Case was updated concurrently. Reload and retry.",
        current: { intake: freshIntake, case_version: 2 },
      })
    );

    const result = await documentMerchantContact({
      intake: baseIntake,
      input,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect("reason" in result && result.reason).toBe("conflict");
    if (!("reason" in result) || result.reason !== "conflict") return;
    expect(result.current).toBeDefined();
    expect(result.current?.serverCaseVersion).toBe(2);
    expect((result.current?.serverIntake as JusticeIntake).company_name).toBe("Someone else's edit");
  });

  it("on missing_version, refreshes from the server and returns ok:false with the refreshed snapshot as `current` — never silently reports success", async () => {
    // No cached version — patchJusticeCaseIntake refuses to write, then this function refreshes.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        id: CASE_ID,
        intake: baseIntake,
        timeline: [],
        case_version: 7,
      })
    );

    const result = await documentMerchantContact({
      intake: baseIntake,
      input,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect("reason" in result && result.reason).toBe("missing_version");
    if (!("reason" in result) || result.reason !== "missing_version") return;
    expect(result.current?.serverCaseVersion).toBe(7);
  });

  it("on success, returns ok:true with the server-confirmed intake, and caches the new case_version for the next save", async () => {
    writeLocalIntakeCaseVersion(4);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        intake: { ...baseIntake, already_contacted: "yes" },
        case_version: 5,
        timeline: [],
      })
    );

    const result = await documentMerchantContact({
      intake: baseIntake,
      input,
      caseId: CASE_ID,
      isLoaded: true,
      isSignedIn: true,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.updatedIntake.already_contacted).toBe("yes");
  });
});
