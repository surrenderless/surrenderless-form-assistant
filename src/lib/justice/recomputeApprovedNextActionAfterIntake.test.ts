import { describe, expect, it } from "vitest";
import { ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF } from "@/lib/justice/assistedSubmissionLane";
import { HANDLING_TRACKING_STEP_COMPLETE } from "@/lib/justice/approvedNextActionHandlingDisplay";
import {
  buildChatCaseClosureGateContext,
  canArchiveCaseViaChat,
} from "@/lib/justice/chatCaseClosureGates";
import { CHAT_INLINE_PACKET_FALLBACK_PREP_HREF } from "@/lib/justice/chatInlineApprovedPrep";
import { resolveRequiredOwnedFilingTaskKind } from "@/lib/justice/ensureOwnedFilingTaskAfterClientStateWrite";
import {
  canArchiveCaseForEscalationLadder,
  hasPendingHumanFulfillmentEscalation,
  shouldExposeCaseResolutionFlow,
} from "@/lib/justice/escalationLadderResolution";
import {
  deriveChatHandlingTrackingLine,
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  MERCHANT_RESOLVED_TERMINAL_HREF,
  MERCHANT_RESOLVED_TERMINAL_LABEL,
} from "@/lib/justice/handlingTrackingProgress";
import {
  merchantContactFilingTaskNotesMarker,
  shouldQueueMerchantContactFilingTask,
} from "@/lib/justice/merchantContactFilingTask";
import { hasOperatorTerminalResponseReviewOutcome } from "@/lib/justice/operatorOwnedCaseArchive";
import {
  buildApprovedNextActionTarget,
  pickPreparedNextAction,
} from "@/lib/justice/preparedNextAction";
import {
  advanceApprovedNextActionAfterCompleted,
  recomputeApprovedNextActionAfterIntake,
  shouldRecomputeApprovedNextActionOnEvidenceChange,
} from "@/lib/justice/recomputeApprovedNextActionAfterIntake";
import { computeJusticeDestinations } from "@/lib/justice/rules";
import type { JusticeDestination, JusticeIntake, MerchantResponseType } from "@/lib/justice/types";

function baseIntake(overrides: Partial<JusticeIntake> = {}): JusticeIntake {
  return {
    problem_category: "charge_dispute",
    company_name: "Acme Bank",
    company_website: "",
    purchase_or_signup: "credit card account",
    story: "Unauthorized charge on my credit card billing statement",
    money_involved: "$250",
    pay_or_order_date: "2024-06-01",
    order_confirmation_details: "",
    user_display_name: "Test User",
    reply_email: "user@example.com",
    already_contacted: "no",
    ...overrides,
  };
}

describe("recomputeApprovedNextActionAfterIntake", () => {
  it("recommends merchant contact when user has not contacted the company", () => {
    const action = recomputeApprovedNextActionAfterIntake(baseIntake());
    expect(action.href).toBe("/justice/merchant");
    expect(action.status).toBe("approved");
  });

  it("preserves handling request tracking from the existing approved action", () => {
    const action = recomputeApprovedNextActionAfterIntake(baseIntake(), {
      existing: {
        href: "/justice/merchant",
        handling_requested_at: "2024-01-02T00:00:00.000Z",
      },
    });
    expect(action.handling_requested_at).toBe("2024-01-02T00:00:00.000Z");
    expect(action.href).toBe("/justice/merchant");
  });
});

describe("shouldRecomputeApprovedNextActionOnEvidenceChange (evidence-upload pre-approval leak)", () => {
  it("blocks the evidence-change recompute/persist BEFORE the packet is approved", () => {
    // Production repro: an unapproved case, consumer uploads evidence (evidenceFileChanged=true).
    // recompute would yield a status:"approved" action — persisting it here is the leak.
    const wouldPersist = recomputeApprovedNextActionAfterIntake(baseIntake());
    expect(wouldPersist.status).toBe("approved"); // why the gate is required

    expect(
      shouldRecomputeApprovedNextActionOnEvidenceChange({
        preparedPacketApproved: false,
        evidenceFileChanged: true,
      })
    ).toBe(false); // gate closed pre-approval → nothing persisted, no approved status, no narration
  });

  it("allows the recompute/persist AFTER the packet is approved when evidence actually changed", () => {
    expect(
      shouldRecomputeApprovedNextActionOnEvidenceChange({
        preparedPacketApproved: true,
        evidenceFileChanged: true,
      })
    ).toBe(true);
  });

  it("never fires when the evidence-file signal did not change, regardless of approval", () => {
    expect(
      shouldRecomputeApprovedNextActionOnEvidenceChange({
        preparedPacketApproved: true,
        evidenceFileChanged: false,
      })
    ).toBe(false);
    expect(
      shouldRecomputeApprovedNextActionOnEvidenceChange({
        preparedPacketApproved: false,
        evidenceFileChanged: false,
      })
    ).toBe(false);
  });
});

describe("advanceApprovedNextActionAfterCompleted", () => {
  const contactedIntake = baseIntake({
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2024-05-15",
    merchant_response_type: "no_response",
    contact_proof_type: "paste",
    contact_proof_text: "No reply after two emails",
  });

  it("advances queue from merchant to payment dispute after merchant is handled", () => {
    const next = advanceApprovedNextActionAfterCompleted(
      contactedIntake,
      "/justice/merchant"
    );
    expect(next?.href).toBe("/justice/payment-dispute");
    expect(next?.status).toBe("approved");
  });

  it("returns null when completed href is empty", () => {
    expect(advanceApprovedNextActionAfterCompleted(contactedIntake, "  ")).toBeNull();
  });

  it("advances from merchant to owned FTC after merchant is handled for failed-contact retail intake", () => {
    const practiceIntake = baseIntake({
      problem_category: "online_purchase",
      company_name: "Acme Retail",
      story: "Item never arrived",
      purchase_or_signup: "web order",
      money_involved: "",
      pay_or_order_date: "",
      already_contacted: "yes",
      contact_method: "email",
      contact_date: "2024-05-15",
      merchant_response_type: "refused_help",
      contact_proof_type: "paste",
      contact_proof_text: "Refund denied",
    });

    expect(
      advanceApprovedNextActionAfterCompleted(practiceIntake, "/justice/merchant")?.href
    ).toBe("/justice/ftc");

    expect(
      advanceApprovedNextActionAfterCompleted(practiceIntake, "/justice/ftc-review")?.href
    ).toBe("/justice/bbb");

    expect(
      advanceApprovedNextActionAfterCompleted(practiceIntake, "/justice/ftc")?.href
    ).toBe("/justice/bbb");
  });
});

describe("recomputeApprovedNextActionAfterIntake CFPB sticky selection", () => {
  const cfpbIntakeNoEvidence = baseIntake({
    problem_category: "financial_account_issue",
    company_name: "North Bank",
    story: "Unauthorized charge on my checking account, bank won't reverse it",
    purchase_or_signup: "checking account",
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2024-05-15",
    merchant_response_type: "refused_help",
    contact_proof_type: "upload",
    // no contact_proof_text, no evidence — nothing verifies this "upload" claim
  });

  const existingCfpbApproved = {
    label: "CFPB",
    href: "/justice/cfpb",
    status: "approved" as const,
    approved_at: "2024-06-01T00:00:00.000Z",
  };

  it("keeps an already-approved CFPB action selected (not reassigned) when evidence is missing", () => {
    const action = recomputeApprovedNextActionAfterIntake(cfpbIntakeNoEvidence, {
      existing: existingCfpbApproved,
      hasUploadedEvidenceFile: false,
    });
    expect(action.href).toBe("/justice/cfpb");
    expect(action.proof_required).toBe(true);
    expect(action.approved_at).toBe("2024-06-01T00:00:00.000Z");
  });

  it("unblocks the same CFPB selection once real evidence exists, without jumping to a different destination", () => {
    const action = recomputeApprovedNextActionAfterIntake(cfpbIntakeNoEvidence, {
      existing: existingCfpbApproved,
      hasUploadedEvidenceFile: true,
    });
    expect(action.href).toBe("/justice/cfpb");
    expect(action.proof_required).toBe(false);
  });

  it("re-blocks a previously-unblocked CFPB action when evidence is later deleted", () => {
    const unblocked = {
      ...existingCfpbApproved,
      proof_required: false,
    };
    const action = recomputeApprovedNextActionAfterIntake(cfpbIntakeNoEvidence, {
      existing: unblocked,
      hasUploadedEvidenceFile: false,
    });
    expect(action.href).toBe("/justice/cfpb");
    expect(action.proof_required).toBe(true);
  });

  it("does not apply the sticky/grandfather branch once the CFPB action is completed", () => {
    const completed = { ...existingCfpbApproved, status: "completed" as const };
    const action = recomputeApprovedNextActionAfterIntake(cfpbIntakeNoEvidence, {
      existing: completed,
      hasUploadedEvidenceFile: false,
    });
    // Normal fresh-pick path resumes; CFPB is not force-kept once completed.
    expect(action.href).not.toBe("/justice/cfpb");
  });

  it("does not grandfather a CFPB destination that was only offered, never approved", () => {
    const action = recomputeApprovedNextActionAfterIntake(cfpbIntakeNoEvidence, {
      existing: { href: "/justice/merchant", status: "completed" as const },
      hasUploadedEvidenceFile: false,
    });
    expect(action.href).not.toBe("/justice/cfpb");
  });
});

describe("computeJusticeDestinations bbb_practice routing", () => {
  const failedContactIntake = baseIntake({
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2024-05-15",
    merchant_response_type: "no_response",
    contact_proof_type: "paste",
    contact_proof_text: "No reply after two emails",
  });

  it("includes BBB mock practice when failed-contact unlock matches FTC practice", () => {
    const destinations = computeJusticeDestinations(failedContactIntake, { manualFtc: false });
    const bbbPractice = destinations.find((d) => d.id === "bbb_practice");

    expect(bbbPractice).toMatchObject({
      status: "available",
      priority: 31,
      internalRoute: ASSISTED_SUBMISSION_BBB_MOCK_PRACTICE_PREP_HREF,
    });
  });

  it("keeps BBB mock practice locked until failed contact is documented", () => {
    const destinations = computeJusticeDestinations(baseIntake(), { manualFtc: false });
    const bbbPractice = destinations.find((d) => d.id === "bbb_practice");

    expect(bbbPractice).toMatchObject({
      status: "later",
      internalRoute: undefined,
    });
  });

  it("leaves the real BBB complaint destination on /justice/bbb", () => {
    const destinations = computeJusticeDestinations(failedContactIntake, { manualFtc: false });
    const bbb = destinations.find((d) => d.id === "bbb");

    expect(bbb).toMatchObject({
      status: "manual",
      internalRoute: "/justice/bbb",
    });
  });
});

describe("recomputeApprovedNextActionAfterIntake — merchant-resolved consumer-owned terminal", () => {
  const resolvedIntake = baseIntake({
    already_contacted: "yes",
    contact_method: "email",
    contact_date: "2024-05-15",
    merchant_response_type: "resolved",
    contact_proof_type: "paste",
    contact_proof_text: "Refund confirmed by email",
  });

  it("(1) produces a persisted terminal state — completed, distinct href, no operator ownership fields", () => {
    const action = recomputeApprovedNextActionAfterIntake(resolvedIntake);

    expect(action.href).toBe(MERCHANT_RESOLVED_TERMINAL_HREF);
    expect(action.status).toBe("completed");
    expect(action.label).toBe(MERCHANT_RESOLVED_TERMINAL_LABEL);
    expect(action.completed_at?.trim()).toBeTruthy();
    // Distinct from both a real escalation destination href and the generic
    // "nothing routable" fallback href — never conflated with either.
    expect(action.href).not.toBe("/justice/merchant");
    expect(action.href).not.toBe(CHAT_INLINE_PACKET_FALLBACK_PREP_HREF);
  });

  it("(1b) never inherits stale handling/outcome fields from an unrelated prior in-flight action", () => {
    const action = recomputeApprovedNextActionAfterIntake(resolvedIntake, {
      existing: {
        href: "/justice/bbb",
        status: "approved",
        handling_requested_at: "2024-01-01T00:00:00.000Z",
        outcome_note: "Some unrelated prior note",
        follow_up_needed: true,
      },
    });
    expect(action.handling_requested_at).toBeUndefined();
    expect(action.handling_acknowledged_at).toBeUndefined();
    expect(action.outcome_note).toBeUndefined();
    expect(action.follow_up_needed).toBeUndefined();
  });

  it("(1c) idempotent: recomputing the same already-terminal action preserves its original approved_at/completed_at", () => {
    const firstComputed = recomputeApprovedNextActionAfterIntake(resolvedIntake);
    expect(firstComputed.approved_at?.trim()).toBeTruthy();
    expect(firstComputed.completed_at?.trim()).toBeTruthy();

    // Recompute again, as if an unrelated intake edit or the evidence-change effect re-fired,
    // passing the FIRST result back in as `existing` — exactly what a real caller does.
    const recomputedLater = recomputeApprovedNextActionAfterIntake(resolvedIntake, {
      existing: firstComputed,
    });

    expect(recomputedLater.href).toBe(MERCHANT_RESOLVED_TERMINAL_HREF);
    expect(recomputedLater.status).toBe("completed");
    expect(recomputedLater.approved_at).toBe(firstComputed.approved_at);
    expect(recomputedLater.completed_at).toBe(firstComputed.completed_at);
  });

  it("(1d) a genuine transition FROM an unrelated action still gets fresh timestamps, not the unrelated action's", () => {
    const action = recomputeApprovedNextActionAfterIntake(resolvedIntake, {
      existing: {
        href: "/justice/bbb",
        status: "completed",
        approved_at: "2020-01-01T00:00:00.000Z",
        completed_at: "2020-01-02T00:00:00.000Z",
      },
    });

    expect(action.href).toBe(MERCHANT_RESOLVED_TERMINAL_HREF);
    expect(action.approved_at).not.toBe("2020-01-01T00:00:00.000Z");
    expect(action.completed_at).not.toBe("2020-01-02T00:00:00.000Z");
  });

  it("(1e) the OTHER reachable path: an existing owned /justice/merchant approved action (from approving while already_contacted was 'no') is correctly replaced by the terminal action once contact is later documented as resolved, dropping any handling-request tracking that action carried", () => {
    const action = recomputeApprovedNextActionAfterIntake(resolvedIntake, {
      existing: {
        label: "Merchant contact",
        href: MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
        status: "approved",
        handling_requested_at: "2026-01-05T00:00:00.000Z",
      },
    });

    expect(action.href).toBe(MERCHANT_RESOLVED_TERMINAL_HREF);
    expect(action.status).toBe("completed");
    expect(action.handling_requested_at).toBeUndefined();
  });

  it("(2) the resulting persisted client state passes the real consumer closure gates end-to-end", () => {
    const action = recomputeApprovedNextActionAfterIntake(resolvedIntake);
    const caseId = "11111111-1111-4111-8111-111111111111";

    expect(hasPendingHumanFulfillmentEscalation({ approvedAction: action, caseId, tasks: [] })).toBe(
      false
    );
    expect(
      shouldExposeCaseResolutionFlow({ approvedAction: action, caseId, tasks: [], filings: [] })
    ).toBe(true);
    expect(
      canArchiveCaseForEscalationLadder({ approvedAction: action, caseId, tasks: [], filings: [] })
    ).toBe(true);

    const resolutionFlowExposed = shouldExposeCaseResolutionFlow({
      approvedAction: action,
      caseId,
      tasks: [],
      filings: [],
    });
    // Real production derivation, not a hardcoded stand-in — and deliberately fed the worst
    // possible manual-action readiness (nothing reviewed, no packet approval, no evidence) to
    // prove the terminal step is reached via deriveChatManualActionNextStep's dedicated
    // MERCHANT_RESOLVED_TERMINAL_HREF branch, not because the ordinary readiness checks happen
    // to already be satisfied.
    const handlingTrackingStep = deriveChatHandlingTrackingLine({
      basicsReady: false,
      draftReviewed: false,
      preparedPacketApproved: false,
      evidenceCount: 0,
      filings: [],
      next: action,
      caseId,
      tasks: [],
    });
    expect(handlingTrackingStep).toBe(HANDLING_TRACKING_STEP_COMPLETE);

    const closureContext = buildChatCaseClosureGateContext({
      caseId,
      resolutionFlowExposed,
      followUpNeeded: action.follow_up_needed === true,
      handlingTrackingStep,
      readinessLoading: false,
      operatorOwnsClosure: hasOperatorTerminalResponseReviewOutcome(action),
    });
    expect(canArchiveCaseViaChat(closureContext)).toBe(true);
  });

  it("(3) contains no operator-ownership marker and requires no follow-up-review task", () => {
    const action = recomputeApprovedNextActionAfterIntake(resolvedIntake);

    expect(hasOperatorTerminalResponseReviewOutcome(action)).toBe(false);
    expect(
      resolveRequiredOwnedFilingTaskKind({
        prepared_packet_approved: true,
        approved_next_action: action,
      })
    ).toBeNull();
  });

  it("(3b) proves the tasks: [] used above is realistic, not assumed: with already_contacted already 'yes' at packet-approval time, the client's own approve handler (pickPreparedNextAction, not this function) never recommends the merchant-contact destination, so ensureOwnedFilingTaskAfterClientStateWrite's merchant_contact kind (gated on that exact href) is never triggered and no owned task or filing is ever queued for this case", () => {
    const useCompanyContactLabels = false;
    const destinations = computeJusticeDestinations(resolvedIntake, {
      manualFtc: false,
      useCompanyContactLabels,
    });
    const prepared = pickPreparedNextAction({
      contacted: resolvedIntake.already_contacted === "yes",
      useCompanyContactLabels,
      destinations,
    });
    const approvedAtPacketApproval = buildApprovedNextActionTarget(prepared);

    expect(approvedAtPacketApproval.href).not.toBe(MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF);
    expect(
      shouldQueueMerchantContactFilingTask({
        prepared_packet_approved: true,
        approved_next_action: approvedAtPacketApproval,
      })
    ).toBe(false);

    // Defense-in-depth check on the gate itself (not a claim this can happen here): if a
    // merchant-contact task somehow were left open for this case, hasPendingHumanFulfillmentEscalation
    // would still correctly catch and block it — the "no lingering task" proof above is what
    // makes tasks: [] the real state, not a limitation of the gate that happens to go unexercised.
    const caseId = "11111111-1111-4111-8111-111111111111";
    const strayOpenMerchantContactTask = {
      id: "task-stray",
      user_id: "user",
      case_id: caseId,
      title: "Merchant contact: Acme Bank",
      due_date: null,
      notes: merchantContactFilingTaskNotesMarker(caseId),
      completed_at: null,
      created_at: "2024-05-15T00:00:00.000Z",
      updated_at: "2024-05-15T00:00:00.000Z",
    };
    const action = recomputeApprovedNextActionAfterIntake(resolvedIntake);
    expect(
      hasPendingHumanFulfillmentEscalation({
        approvedAction: action,
        caseId,
        tasks: [strayOpenMerchantContactTask],
      })
    ).toBe(true);
  });

  it("(4a) other merchant-response values keep routing to a real destination, not the terminal marker", () => {
    const otherResponses: MerchantResponseType[] = [
      "no_response",
      "refused_help",
      "promised_but_did_not_fix",
      "partial_help",
      "asked_more_info",
      "other",
    ];
    for (const merchant_response_type of otherResponses) {
      const intake = baseIntake({
        already_contacted: "yes",
        contact_method: "email",
        contact_date: "2024-05-15",
        merchant_response_type,
        contact_proof_type: "paste",
        contact_proof_text: "Documented contact",
      });
      const action = recomputeApprovedNextActionAfterIntake(intake);
      expect(action.href).not.toBe(MERCHANT_RESOLVED_TERMINAL_HREF);
      expect(action.status).not.toBe("completed");
    }
  });

  it("(4b) not-yet-contacted intake still routes to merchant contact regardless of response type", () => {
    const action = recomputeApprovedNextActionAfterIntake(
      baseIntake({ already_contacted: "no" })
    );
    expect(action.href).toBe("/justice/merchant");
    expect(action.status).toBe("approved");
  });

  it("(4c) a genuinely exhausted ladder (nothing routable for an unrelated reason) keeps the old generic fallback shape, untouched by this change", () => {
    // Hand-built, all-"later" destinations for a reason that has nothing to do with
    // isMerchantResolved — proves pickPreparedNextAction/buildApprovedNextActionTarget (the
    // pre-existing "nothing routable" machinery) are unmodified and still produce
    // status: "approved" on the generic fallback href, not this change's terminal marker.
    const allLaterDestinations: JusticeDestination[] = [
      {
        id: "merchant_resolution",
        label: "Merchant contact & proof",
        rationale: "n/a",
        status: "later",
        priority: 10,
      },
      {
        id: "payment_dispute",
        label: "Payment dispute (bank/card)",
        rationale: "n/a",
        status: "later",
        priority: 20,
      },
    ];
    const prepared = pickPreparedNextAction({
      contacted: true,
      useCompanyContactLabels: false,
      destinations: allLaterDestinations,
    });
    const action = buildApprovedNextActionTarget(prepared);

    expect(action.href).toBe(CHAT_INLINE_PACKET_FALLBACK_PREP_HREF);
    expect(action.status).toBe("approved");
    expect(action.href).not.toBe(MERCHANT_RESOLVED_TERMINAL_HREF);
  });

  it("(precedence) an active, not-yet-completed CFPB action is preserved even when merchant_response_type is resolved — never silently overridden", () => {
    // Placing the resolved branch AFTER the existing-active-CFPB check (not before) is
    // deliberate: that check's own pre-existing contract is "an active CFPB action must never
    // be silently reassigned" (a real, possibly in-flight government-complaint filing/operator
    // task). If the resolved branch ran first, updating merchant_response_type after CFPB is
    // already active would silently abandon that in-flight step. This proves the consumer is
    // only ever DELAYED behind it, never permanently stranded: once CFPB itself reaches
    // status: "completed" through its own real completion path, the very next recompute falls
    // through correctly to the terminal branch.
    const cfpbActiveThenResolvedIntake = baseIntake({
      problem_category: "financial_account_issue",
      company_name: "North Bank",
      story: "Unauthorized charge on my checking account, bank won't reverse it",
      purchase_or_signup: "checking account",
      already_contacted: "yes",
      contact_method: "email",
      contact_date: "2024-05-15",
      merchant_response_type: "resolved",
      contact_proof_type: "paste",
      contact_proof_text: "Refund confirmed",
    });
    const existingActiveCfpb = {
      label: "CFPB",
      href: "/justice/cfpb",
      status: "approved" as const,
      approved_at: "2024-06-01T00:00:00.000Z",
    };

    const whileCfpbActive = recomputeApprovedNextActionAfterIntake(cfpbActiveThenResolvedIntake, {
      existing: existingActiveCfpb,
    });
    expect(whileCfpbActive.href).toBe("/justice/cfpb");
    expect(whileCfpbActive.status).toBe("approved");

    const afterCfpbCompletes = recomputeApprovedNextActionAfterIntake(cfpbActiveThenResolvedIntake, {
      existing: { ...existingActiveCfpb, status: "completed" as const },
    });
    expect(afterCfpbCompletes.href).toBe(MERCHANT_RESOLVED_TERMINAL_HREF);
    expect(afterCfpbCompletes.status).toBe("completed");
  });
});
