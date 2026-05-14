/**
 * Normalize `JusticeIntake.company_website` for intake and chat flows.
 * Empty / sentinel → "". Bare host → `https://…`. Existing http(s) URLs unchanged.
 */
export function normalizeCompanyWebsite(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  const lower = t.toLowerCase();
  if (lower === "none" || lower === "n/a" || lower === "-" || lower === "no") return "";
  if (/^https:\/\//i.test(t) || /^http:\/\//i.test(t)) return t;
  return `https://${t}`;
}
