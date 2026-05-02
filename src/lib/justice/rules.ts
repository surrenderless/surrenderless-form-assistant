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

export function isMerchantResolved(intake: JusticeIntake): boolean {
  return intake.already_contacted === "yes" && intake.merchant_response_type === "resolved";
}

function intakeTextBlob(intake: JusticeIntake): string {
  return `${intake.story} ${intake.purchase_or_signup} ${intake.company_name}`.toLowerCase();
}

function matchesFccHints(intake: JusticeIntake): boolean {
  const t = intakeTextBlob(intake);
  const hints = ["telecom", "isp", "internet service", "internet provider", "phone bill", "wireless", "carrier", "mobile plan", "cellular", "broadband", "cable tv", "robocall"];
  return hints.some((h) => t.includes(h));
}

function matchesDotHints(intake: JusticeIntake): boolean {
  const t = intakeTextBlob(intake);
  const hints = ["flight", "airline", "airport", "baggage", "tsa", "ticket", "carrier delay", "dot ", "aviation"];
  return hints.some((h) => t.includes(h));
}

function cfpbLikelyRelevant(intake: JusticeIntake): boolean {
  const cat = intake.problem_category;
  if (cat === "subscription" || cat === "charge_dispute") return true;
  return paymentDisputeAvailable(intake);
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
    ftcRationale = "Not recommended while you consider the issue resolved with the merchant.";
    ftcRoute = undefined;
  } else if (ftcOpen) {
    ftcStatus = "recommended";
    ftcRationale = "Practice complaint flow when merchant contact failed or was refused.";
    ftcRoute = "/justice/ftc-review";
  } else {
    ftcStatus = "later";
    ftcRationale = "Unlocks after you document merchant contact and a failed or refused outcome.";
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
    });
    push({
      id: "cfpb",
      label: "CFPB",
      rationale: "Less relevant while the case is marked resolved with the merchant.",
      status: "later",
      priority: 60,
    });
    push({
      id: "fcc",
      label: "FCC",
      rationale: "Typically for telecom issues — revisit if problems continue.",
      status: "later",
      priority: 70,
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
    });
    const cfpbRel = cfpbLikelyRelevant(intake);
    push({
      id: "cfpb",
      label: "CFPB",
      rationale: cfpbRel
        ? "May fit billing, subscriptions, or financial product problems."
        : "Often relevant for bank/card or lending issues; confirm your facts match their scope.",
      status: cfpbRel ? "manual" : "later",
      priority: 60,
    });
    push({
      id: "fcc",
      label: "FCC",
      rationale: matchesFccHints(intake)
        ? "May fit phone, internet, or TV service issues."
        : "Usually for telecom, broadcast, or related billing disputes.",
      status: matchesFccHints(intake) ? "manual" : "later",
      priority: 70,
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
