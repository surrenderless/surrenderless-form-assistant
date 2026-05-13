import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";

export type JusticeTaskDueKind = "completed" | "overdue" | "due_today" | "upcoming" | "no_due_date";

const LABELS: Record<JusticeTaskDueKind, string> = {
  completed: "Completed",
  overdue: "Overdue",
  due_today: "Due today",
  upcoming: "Upcoming",
  no_due_date: "No due date",
};

/** Local calendar YYYY-MM-DD for `d` (no time component). */
function localYmdFromDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function localTodayYmd(now: Date = new Date()): string {
  return localYmdFromDate(now);
}

/**
 * Interprets `due_date` text as a calendar day in the user's local timezone.
 * Plain `YYYY-MM-DD` is compared lexicographically to today (avoids UTC parse shifts).
 * Other strings fall back to `Date` parsing and local calendar fields.
 */
export function parseDueDateToLocalYmd(dueDate: string | null | undefined): string | null {
  const raw = dueDate?.trim();
  if (!raw) return null;

  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (iso) {
    const y = Number(iso[1]);
    const mo = Number(iso[2]);
    const day = Number(iso[3]);
    if (y < 1000 || y > 9999 || mo < 1 || mo > 12 || day < 1 || day > 31) return null;
    const test = new Date(y, mo - 1, day);
    if (test.getFullYear() !== y || test.getMonth() !== mo - 1 || test.getDate() !== day) return null;
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const dt = new Date(raw);
  if (Number.isNaN(dt.getTime())) return null;
  return localYmdFromDate(dt);
}

export function getJusticeTaskDueKind(
  row: Pick<JusticeCaseTaskRow, "due_date" | "completed_at">
): JusticeTaskDueKind {
  if (row.completed_at?.trim()) return "completed";

  const ymd = parseDueDateToLocalYmd(row.due_date);
  if (!ymd) return "no_due_date";

  const today = localTodayYmd();
  if (ymd < today) return "overdue";
  if (ymd === today) return "due_today";
  return "upcoming";
}

export function justiceTaskDueKindLabel(kind: JusticeTaskDueKind): string {
  return LABELS[kind];
}

/** Tailwind classes for a compact pill badge (light + dark). */
export function justiceTaskDueBadgeClass(kind: JusticeTaskDueKind): string {
  const base =
    "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide";
  switch (kind) {
    case "completed":
      return `${base} bg-emerald-100 text-emerald-900 dark:bg-emerald-950/60 dark:text-emerald-200`;
    case "overdue":
      return `${base} bg-red-100 text-red-900 dark:bg-red-950/50 dark:text-red-200`;
    case "due_today":
      return `${base} bg-amber-100 text-amber-950 dark:bg-amber-950/40 dark:text-amber-100`;
    case "upcoming":
      return `${base} bg-sky-100 text-sky-950 dark:bg-sky-950/40 dark:text-sky-100`;
    case "no_due_date":
      return `${base} bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300`;
  }
}
