import type {
  DestinationStatus,
  JusticeDestination,
  JusticeDestinationsContext,
  JusticeIntake,
} from "./types";

const FTC_UNLOCK_RESPONSES = new Set([
  "no_response",
  "refused_help",
  "promised_but_did_not_fix",
]);

export function paymentDisputeAvailable(intake: JusticeIntake): boolean {
  const money = intake.money_involved?.trim();
  const date = intake.pay_or_order_date?.trim();
  if (!money || !date) return false;
  const lower = money.toLowerCase();
  if (lower === "not sure" || lower === "n/a" || lower === "na") return false;
  return true;
}

export function ftcUnlockedFromIntake(intake: JusticeIntake): boolean {
  if (intake.already_contacted !== "yes") return false;
  const r = intake.merchant_response_type;
  return !!r && FTC_UNLOCK_RESPONSES.has(r);
}

export function computeFtcUnlocked(intake: JusticeIntake, manualEscalate: boolean): boolean {
  if (manualEscalate) return true;
  return ftcUnlockedFromIntake(intake);
}

const ISO_CONTACT_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Calendar date saved from the contact proof form (YYYY-MM-DD). */
export function isValidDocumentedContactDate(s: string | undefined): boolean {
  if (!s?.trim()) return false;
  const t = s.trim();
  if (!ISO_CONTACT_DATE_RE.test(t)) return false;
  const d = new Date(`${t}T12:00:00`);
  return !Number.isNaN(d.getTime());
}

/**
 * True when intake records a documented contact attempt sufficient for CFPB prep unlock
 * (method, valid date, outcome, description when proof type is "none", ticket/case text when "ticket").
 */
export function cfpbPrepDocumentedFromIntake(intake: JusticeIntake): boolean {
  if (intake.already_contacted !== "yes") return false;
  if (!intake.contact_method) return false;
  if (!isValidDocumentedContactDate(intake.contact_date)) return false;
  if (!intake.merchant_response_type) return false;
  const proofType = intake.contact_proof_type ?? "none";
  if (proofType === "none") {
    return (intake.contact_proof_text?.trim().length ?? 0) > 0;
  }
  if (proofType === "ticket") {
    return (intake.contact_proof_text?.trim().length ?? 0) > 0;
  }
  return true;
}

/** CFPB prep / escalation checklist unlock (manual bypass matches FTC manual escalate). */
export function cfpbPrepUnlockedFromIntake(intake: JusticeIntake, manualEscalate: boolean): boolean {
  if (manualEscalate) return true;
  return cfpbPrepDocumentedFromIntake(intake);
}

export function isMerchantResolved(intake: JusticeIntake): boolean {
  return intake.already_contacted === "yes" && intake.merchant_response_type === "resolved";
}

function intakeTextBlob(intake: JusticeIntake): string {
  return `${intake.story} ${intake.purchase_or_signup} ${intake.company_name}`.toLowerCase();
}

function matchesFccHints(intake: JusticeIntake): boolean {
  const t = intakeTextBlob(intake);
  const hints = [
    "telecom",
    "isp",
    "internet service",
    "internet provider",
    "phone bill",
    "wireless",
    "carrier",
    "mobile plan",
    "cellular",
    "broadband",
    "cable tv",
    "cable ",
    "robocall",
    "spam call",
    "spam text",
    "broadcast",
    "radio ",
    "tv service",
    "telemarketing",
  ];
  return hints.some((h) => t.includes(h));
}

export function fccLikelyRelevant(intake: JusticeIntake): boolean {
  return matchesFccHints(intake);
}

function matchesDotHints(intake: JusticeIntake): boolean {
  const t = intakeTextBlob(intake);
  const hints = ["flight", "airline", "airport", "baggage", "tsa", "ticket", "carrier delay", "dot ", "aviation"];
  return hints.some((h) => t.includes(h));
}

/** Text signals that a complaint may involve CFPB-regulated financial products/services (not ordinary retail goods alone). */
function matchesCfpbFinancialHints(intake: JusticeIntake): boolean {
  const t = intakeTextBlob(intake);
  if (/\bapr\b/.test(t)) return true;
  const hints = [
    "billing",
    "billed",
    "invoice",
    "recurring",
    "autopay",
    "auto-pay",
    "renewal",
    "credit card",
    "debit card",
    "bank",
    "banking",
    "checking account",
    "savings account",
    "overdraft",
    "mortgage",
    "student loan",
    "auto loan",
    "payday",
    "lender",
    "lending",
    "interest rate",
    "debt",
    "collection",
    "collector",
    "credit report",
    "credit score",
    "equifax",
    "experian",
    "transunion",
    "chargeback",
    "wire transfer",
    "ach",
    "direct deposit",
    "finance charge",
    "late fee",
    "minimum payment",
    "unauthorized",
    "overdraft fee",
  ];
  return hints.some((h) => t.includes(h));
}

export function cfpbLikelyRelevant(intake: JusticeIntake): boolean {
  const cat = intake.problem_category;
  if (cat === "financial_account_issue" || cat === "subscription" || cat === "charge_dispute") return true;
  return matchesCfpbFinancialHints(intake);
}

export function computeJusticeDestinations(
  intake: JusticeIntake,
  ctx: JusticeDestinationsContext
): JusticeDestination[] {
  const resolved = isMerchantResolved(intake);
  const paymentOk = paymentDisputeAvailable(intake);
  const ftcOpen = computeFtcUnlocked(intake, ctx.manualFtc);
  const contacted = intake.already_contacted === "yes";
  const hasCompany = intake.company_name.trim().length > 0;
  const cfpbRel = cfpbLikelyRelevant(intake);
  const fccRel = fccLikelyRelevant(intake);

  const out: JusticeDestination[] = [];

  const push = (d: JusticeDestination) => {
    out.push(d);
  };

  let mrStatus: DestinationStatus;
  let mrRationale: string;
  if (resolved) {
    mrStatus = "later";
    mrRationale = "You marked the merchant issue resolved; update your record here if anything changes.";
  } else if (!contacted) {
    mrStatus = "recommended";
    mrRationale = "Contact the business first and save proof — often the fastest fix.";
  } else {
    mrStatus = "available";
    mrRationale = "Document what you sent and how they responded.";
  }
  push({
    id: "merchant_resolution",
    label: "Merchant contact & proof",
    rationale: mrRationale,
    status: mrStatus,
    priority: 10,
    internalRoute: "/justice/merchant",
  });

  let payStatus: DestinationStatus;
  let payRationale: string;
  let payRoute: string | undefined;
  if (resolved) {
    payStatus = "later";
    payRationale = "Less relevant while the case is marked resolved with the merchant.";
    payRoute = undefined;
  } else if (paymentOk) {
    payStatus = "available";
    payRationale = "Use your bank or card issuer if a charge should be reversed.";
    payRoute = "/justice/payment-dispute";
  } else {
    payStatus = "later";
    payRationale = "Add payment amount and order date in your answers to unlock the checklist.";
    payRoute = undefined;
  }
  push({
    id: "payment_dispute",
    label: "Payment dispute (bank/card)",
    rationale: payRationale,
    status: payStatus,
    priority: 20,
    internalRoute: payRoute,
  });

  let ftcStatus: DestinationStatus;
  let ftcRationale: string;
  let ftcRoute: string | undefined;
  if (resolved) {
    ftcStatus = "later";
    ftcRationale = ctx.useCompanyContactLabels
      ? "Not recommended while you consider the issue resolved with the company."
      : "Not recommended while you consider the issue resolved with the merchant.";
    ftcRoute = undefined;
  } else if (ftcOpen) {
    if (cfpbRel) {
      ftcStatus = "available";
      ftcRationale = ctx.useCompanyContactLabels
        ? "Practice complaint flow when company contact failed; for bank/credit/billing issues, CFPB prep above is usually the stronger next step."
        : "Practice complaint flow when merchant contact failed; for bank/credit/billing issues, CFPB prep above is usually the stronger next step.";
    } else if (fccRel) {
      ftcStatus = "available";
      ftcRationale = ctx.useCompanyContactLabels
        ? "Practice complaint flow when company contact failed; for phone, internet, cable, or unwanted-call issues, FCC prep above is usually the stronger next step."
        : "Practice complaint flow when merchant contact failed; for phone, internet, cable, or unwanted-call issues, FCC prep above is usually the stronger next step.";
    } else {
      ftcStatus = "recommended";
      ftcRationale = ctx.useCompanyContactLabels
        ? "Practice complaint flow when company contact failed or was refused."
        : "Practice complaint flow when merchant contact failed or was refused.";
    }
    ftcRoute = "/justice/ftc-review";
  } else {
    ftcStatus = "later";
    ftcRationale = ctx.useCompanyContactLabels
      ? "Unlocks after you document company contact and a failed or refused outcome."
      : "Unlocks after you document merchant contact and a failed or refused outcome.";
    ftcRoute = undefined;
  }
  push({
    id: "ftc",
    label: "FTC (consumer complaint)",
    rationale: ftcRationale,
    status: ftcStatus,
    priority: 30,
    internalRoute: ftcRoute,
  });

  if (resolved) {
    push({
      id: "bbb",
      label: "Better Business Bureau",
      rationale: "Revisit only if the issue returns or was not truly resolved.",
      status: "later",
      priority: 40,
      internalRoute: "/justice/bbb",
    });
    push({
      id: "state_ag",
      label: "State Attorney General",
      rationale: "Revisit only if you need government help after resolution breaks down.",
      status: "later",
      priority: 50,
      internalRoute: "/justice/state-ag",
    });
    push({
      id: "cfpb",
      label: "CFPB",
      rationale: "Less relevant while the case is marked resolved with the merchant.",
      status: "later",
      priority: 60,
      ...(cfpbRel ? { internalRoute: "/justice/cfpb" } : {}),
    });
    push({
      id: "fcc",
      label: "FCC",
      rationale: "Typically for telecom issues — revisit if problems continue.",
      status: "later",
      priority: 70,
      ...(fccRel ? { internalRoute: "/justice/fcc" } : {}),
    });
    push({
      id: "dot",
      label: "USDOT / aviation",
      rationale: "Typically for travel issues — revisit if problems continue.",
      status: "later",
      priority: 80,
    });
  } else {
    push({
      id: "bbb",
      label: "Better Business Bureau",
      rationale: hasCompany
        ? "Voluntary business response program; file externally when ready."
        : "Add a company name to see clearer next steps.",
      status: hasCompany ? "manual" : "later",
      priority: 40,
      internalRoute: "/justice/bbb",
    });
    push({
      id: "state_ag",
      label: "State Attorney General (consumer)",
      rationale: "Many states take consumer complaints; filing is outside this app for now.",
      status: hasCompany ? "manual" : "later",
      priority: 50,
      internalRoute: "/justice/state-ag",
    });
    const cfpbPrepUnlocked = cfpbRel && cfpbPrepUnlockedFromIntake(intake, ctx.manualFtc);
    push({
      id: "cfpb",
      label: "CFPB",
      rationale: !cfpbRel
        ? "Not highlighted until your answers suggest bank, credit, loan, billing, or related financial issues."
        : cfpbPrepUnlocked
          ? "Recommended for bank, credit, loan, payment, debt, billing, or financial account issues."
          : "Available after you document company contact or failed-contact proof.",
      status: !cfpbRel ? "later" : cfpbPrepUnlocked ? "recommended" : "locked",
      priority: cfpbRel ? 28 : 60,
      ...(cfpbPrepUnlocked ? { internalRoute: "/justice/cfpb" } : {}),
    });
    push({
      id: "fcc",
      label: "FCC",
      rationale: fccRel
        ? "Recommended for phone, internet, cable, broadcast, telemarketing, or unwanted-call issues."
        : "Usually for telecom, broadcast, or related billing disputes.",
      status: fccRel ? "recommended" : "later",
      priority: fccRel ? (cfpbRel ? 29 : 27) : 70,
      ...(fccRel ? { internalRoute: "/justice/fcc" } : {}),
    });
    push({
      id: "dot",
      label: "USDOT / aviation consumer",
      rationale: matchesDotHints(intake)
        ? "May fit flights or certain transportation problems."
        : "Usually for aviation or specific transportation complaints.",
      status: matchesDotHints(intake) ? "manual" : "later",
      priority: 80,
    });
  }

  let scStatus: DestinationStatus;
  let scRationale: string;
  if (resolved) {
    scStatus = "later";
    scRationale = "Not needed if you consider the merchant issue resolved.";
  } else {
    scStatus = "later";
    scRationale = "Consider after other steps; dollar limits and rules vary by state.";
  }
  push({
    id: "small_claims",
    label: "Small claims / demand letter",
    rationale: scRationale,
    status: scStatus,
    priority: 90,
  });

  return out.sort((a, b) => a.priority - b.priority);
}
