import type { JusticeIntake } from "./types";

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
