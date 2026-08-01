import { describe, expect, it } from "vitest";
import {
  hydrateApprovedNextActionForDisplay,
  mergeApprovedNextActionTrackingFields,
  parseApprovedNextAction,
  parseJusticeCaseClientState,
  readSessionApprovedNextAction,
  resolveApprovedNextAction,
  STORAGE_APPROVED_NEXT_ACTION_V1,
  writeSessionApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import {
  MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";

const CASE_ID = "550e8400-e29b-41d4-a716-446655440000";

const clearedFollowUpAction = {
  label: "Small claims / demand letter",
  href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  status: "completed" as const,
  follow_up_needed: false as const,
  outcome_note: "Escalation complete.",
  handling_requested_at: "2026-06-23T12:00:00.000Z",
  handling_acknowledged_at: "2026-06-23T12:05:00.000Z",
};

const staleServerClientState = {
  approved_next_action: {
    label: "Small claims / demand letter",
    href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
    status: "completed",
    follow_up_needed: true,
    outcome_note: "Escalation complete.",
    handling_requested_at: "2026-06-23T12:00:00.000Z",
    handling_acknowledged_at: "2026-06-23T12:05:00.000Z",
  },
};

describe("parseApprovedNextAction follow-up round-trip", () => {
  it("preserves explicit follow_up_needed false", () => {
    expect(parseApprovedNextAction(clearedFollowUpAction)?.follow_up_needed).toBe(false);
  });

  it("omits follow_up_needed when absent", () => {
    const { follow_up_needed: _cleared, ...withoutFollowUp } = clearedFollowUpAction;
    expect(parseApprovedNextAction(withoutFollowUp)?.follow_up_needed).toBeUndefined();
  });
});

describe("parseApprovedNextAction proof_required round-trip", () => {
  // This is the regression that would have caught the silent-strip bug: proof_required is
  // reconstructed via an explicit allowlist, not a permissive spread, so a naive addition to
  // the type alone would compile but vanish on every read (GET, PATCH merge, task-creation
  // checks) without this test failing.
  it("preserves proof_required: true through the allowlist reconstruction", () => {
    const action = {
      label: "CFPB",
      href: MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
      status: "approved",
      proof_required: true,
    };
    expect(parseApprovedNextAction(action)?.proof_required).toBe(true);
  });

  it("omits proof_required when absent or false", () => {
    const withoutFlag = {
      label: "CFPB",
      href: MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
      status: "approved",
    };
    expect(parseApprovedNextAction(withoutFlag)?.proof_required).toBeUndefined();

    const explicitFalse = { ...withoutFlag, proof_required: false };
    expect(parseApprovedNextAction(explicitFalse)?.proof_required).toBeUndefined();
  });

  it("survives the full parseJusticeCaseClientState round trip used by shouldQueueCfpbFilingTask", () => {
    const clientState = {
      prepared_packet_approved: true,
      approved_next_action: {
        label: "CFPB",
        href: MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
        status: "approved",
        proof_required: true,
      },
    };
    const parsed = parseJusticeCaseClientState(clientState);
    expect(parsed.approved_next_action?.proof_required).toBe(true);
  });
});

describe("resolveApprovedNextAction follow-up merge", () => {
  it("prefers cleared follow-up when session is false and server is still flagged", () => {
    if (typeof sessionStorage === "undefined") return;

    writeSessionApprovedNextAction(CASE_ID, clearedFollowUpAction);
    expect(readSessionApprovedNextAction(CASE_ID)?.follow_up_needed).toBe(false);

    const resolved = resolveApprovedNextAction(CASE_ID, staleServerClientState);

    expect(resolved?.follow_up_needed).toBe(false);
    sessionStorage.removeItem(STORAGE_APPROVED_NEXT_ACTION_V1);
  });
});

describe("resolveApprovedNextAction authoritative empty server state", () => {
  const staleCachedAction = {
    label: "Payment dispute (bank/card)",
    href: MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
    status: "approved" as const,
  };

  it("returns undefined, not the stale session cache, when a loaded case has no approved_next_action", () => {
    if (typeof sessionStorage === "undefined") return;

    writeSessionApprovedNextAction(CASE_ID, staleCachedAction);
    expect(readSessionApprovedNextAction(CASE_ID)).toBeTruthy();

    const resolved = resolveApprovedNextAction(CASE_ID, { prepared_packet_approved: true });

    expect(resolved).toBeUndefined();
  });

  it("clears the stale session entry as a side effect, so a later session-only read also sees nothing", () => {
    if (typeof sessionStorage === "undefined") return;

    writeSessionApprovedNextAction(CASE_ID, staleCachedAction);
    resolveApprovedNextAction(CASE_ID, { prepared_packet_approved: true });

    expect(readSessionApprovedNextAction(CASE_ID)).toBeUndefined();
  });

  it("does not touch other cases' cached entries when clearing one case's stale entry", () => {
    if (typeof sessionStorage === "undefined") return;

    const otherCaseId = "660e8400-e29b-41d4-a716-446655440111";
    writeSessionApprovedNextAction(CASE_ID, staleCachedAction);
    writeSessionApprovedNextAction(otherCaseId, staleCachedAction);

    resolveApprovedNextAction(CASE_ID, { prepared_packet_approved: true });

    expect(readSessionApprovedNextAction(CASE_ID)).toBeUndefined();
    expect(readSessionApprovedNextAction(otherCaseId)).toBeTruthy();
    sessionStorage.removeItem(STORAGE_APPROVED_NEXT_ACTION_V1);
  });

  it("hydrateApprovedNextActionForDisplay still preserves the session fallback when server state is genuinely unavailable (no clientState arg)", () => {
    if (typeof sessionStorage === "undefined") return;

    writeSessionApprovedNextAction(CASE_ID, staleCachedAction);

    const hydrated = hydrateApprovedNextActionForDisplay(CASE_ID);

    expect(hydrated?.href).toBe(MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF);
    sessionStorage.removeItem(STORAGE_APPROVED_NEXT_ACTION_V1);
  });

  it("hydrateApprovedNextActionForDisplay authoritatively clears when a loaded case has no approved_next_action", () => {
    if (typeof sessionStorage === "undefined") return;

    writeSessionApprovedNextAction(CASE_ID, staleCachedAction);

    const hydrated = hydrateApprovedNextActionForDisplay(CASE_ID, { prepared_packet_approved: true });

    expect(hydrated).toBeUndefined();
    expect(readSessionApprovedNextAction(CASE_ID)).toBeUndefined();
  });
});

describe("mergeApprovedNextActionTrackingFields follow-up clear", () => {
  it("preserves explicit follow_up_needed false for session and PATCH payloads", () => {
    const flagged = {
      label: "Small claims / demand letter",
      href: MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
      status: "completed" as const,
      follow_up_needed: true as const,
      outcome_note: "Escalation complete.",
    };
    const merged = mergeApprovedNextActionTrackingFields(flagged, {
      ...flagged,
      follow_up_needed: false,
    });
    expect(merged.follow_up_needed).toBe(false);
    expect(merged.follow_up_at).toBeUndefined();
  });
});
