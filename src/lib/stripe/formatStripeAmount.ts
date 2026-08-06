/** Stripe currencies whose smallest unit IS the major unit (no /100 conversion). */
const ZERO_DECIMAL_CURRENCIES = new Set([
  "bif",
  "clp",
  "djf",
  "gnf",
  "jpy",
  "kmf",
  "krw",
  "mga",
  "pyg",
  "rwf",
  "ugx",
  "vnd",
  "vuv",
  "xaf",
  "xof",
  "xpf",
]);

/** Formats a Stripe unit_amount (smallest currency unit) + ISO currency into a display string,
 * e.g. (4900, "usd") -> "$49.00". Never hardcodes an amount — both values must come from a real
 * Stripe Price lookup. */
export function formatStripeAmount(unitAmount: number, currency: string): string {
  const normalizedCurrency = currency.toLowerCase();
  const isZeroDecimal = ZERO_DECIMAL_CURRENCIES.has(normalizedCurrency);
  const amount = isZeroDecimal ? unitAmount : unitAmount / 100;
  try {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency.toUpperCase(),
    }).format(amount);
  } catch {
    return `${amount} ${currency.toUpperCase()}`;
  }
}
