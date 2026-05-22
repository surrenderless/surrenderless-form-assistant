"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { validate as isUuid } from "uuid";
import Header from "@/app/components/Header";
import JusticeCaseTasks from "@/app/components/JusticeCaseTasks";
import type {
  DestinationStatus,
  JusticeApprovedNextAction,
  JusticeCaseClientState,
  JusticeDestination,
  JusticeIntake,
  TimelineEntry,
  TimelineEntryType,
} from "@/lib/justice/types";
import {
  JUSTICE_EVIDENCE_TYPE_LABELS,
  type JusticeCaseEvidenceRow,
  type JusticeEvidenceType,
} from "@/lib/justice/evidence";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import {
  STORAGE_CASE_ID,
  STORAGE_FTC_MANUAL_UNLOCK,
  STORAGE_INTAKE,
  STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1,
} from "@/lib/justice/types";
import {
  mergeClientStateWithApprovedNextAction,
  resolveApprovedNextAction,
  writeSessionApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import {
  APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER_WITH_YET,
  APPROVED_NEXT_ACTION_HANDLING_PENDING_DESCRIPTION,
  APPROVED_NEXT_ACTION_HANDLING_REQUESTED_LABEL,
  APPROVED_NEXT_ACTION_HANDLING_TRACKING_ARIA_LABEL,
  APPROVED_NEXT_ACTION_HANDLING_TRACKING_SECTION_LABEL,
  APPROVED_NEXT_ACTION_REQUEST_HANDLING_BUTTON_LABEL,
  APPROVED_NEXT_ACTION_REQUEST_HANDLING_SAVING_LABEL,
  formatHandlingRecordedLine,
} from "@/lib/justice/approvedNextActionHandlingDisplay";

/** Page-local; mirrors packet approval session keys. */
const STORAGE_PREPARED_PACKET_APPROVED_V1 = "justice_prepared_packet_approved_v1";

function readSessionPreparedPacketApproved(caseId: string): boolean {
  if (typeof window === "undefined" || !caseId) return false;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREPARED_PACKET_APPROVED_V1);
    if (!raw) return false;
    const map = JSON.parse(raw) as Record<string, boolean>;
    return map[caseId] === true;
  } catch {
    return false;
  }
}

function isPreparedPacketApprovedInClientState(raw: unknown): boolean {
  if (raw === null || raw === undefined) return false;
  if (typeof raw !== "object" || Array.isArray(raw)) return false;
  return (raw as Record<string, unknown>).prepared_packet_approved === true;
}

function resolvePreparedPacketApproved(caseId: string, clientState: unknown): boolean {
  return (
    isPreparedPacketApprovedInClientState(clientState) || readSessionPreparedPacketApproved(caseId)
  );
}

async function persistApprovedNextActionClientState(
  caseId: string,
  approvedNext: JusticeApprovedNextAction
): Promise<void> {
  try {
    const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
    if (!getRes.ok) {
      console.warn("justice plan: GET /api/justice/cases/[id] (client_state) failed", getRes.status);
      return;
    }
    const existing = (await getRes.json()) as { client_state?: unknown };
    const merged = mergeClientStateWithApprovedNextAction(existing.client_state, approvedNext);
    const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_state: merged }),
    });
    if (!patchRes.ok) {
      console.warn("justice plan: PATCH /api/justice/cases/[id] (client_state) failed", patchRes.status);
    }
  } catch (e) {
    console.warn("justice plan: PATCH /api/justice/cases/[id] (client_state) error", e);
  }
}

import { ApprovedNextActionFollowUpTimingLine } from "@/lib/justice/approvedNextActionFollowUp";
import { isBasicCaseInfoReadyForEscalation } from "@/lib/justice/caseReadiness";
import { parseJusticeCasesListEnvelope } from "@/lib/justice/caseApiValidation";
import {
  cfpbLikelyRelevant,
  cfpbPrepDocumentedFromIntake,
  cfpbPrepUnlockedFromIntake,
  computeFtcUnlocked,
  computeJusticeDestinations,
  dotLikelyRelevant,
  fccLikelyRelevant,
  isMerchantResolved,
  paymentDisputeAvailable,
} from "@/lib/justice/rules";
import { clearLocalJusticeSession } from "@/lib/justice/clearLocalJusticeSession";
import { buildMerchantMessage } from "@/lib/justice/buildMerchantContactMessage";
import {
  buildBankLetter as buildPaymentDisputeBankLetter,
  buildDefaultPaymentDisputeDraft,
} from "@/lib/justice/buildPaymentDisputeBankLetter";
import {
  appendActionPlanViewedOnce,
  appendEscalationUnlockedFromMerchantSaveOnce,
  appendMerchantContactSavedOnce,
  readTimeline,
  replaceTimelineForCase,
} from "@/lib/justice/timeline";

const MERCHANT_MESSAGE_PLAN_PREVIEW_MAX = 560;
const PAYMENT_DISPUTE_LETTER_PLAN_PREVIEW_MAX = 560;
const FTC_STORY_PLAN_PREVIEW_MAX = 200;
const BBB_STATE_AG_STORY_PLAN_PREVIEW_MAX = 200;
const FINAL_FOLLOWUP_CONTACT_PROOF_PREVIEW_MAX = 160;
const PLAN_EVIDENCE_PREVIEW_DESC_MAX = 120;

function planEvidenceTypeLabel(t: string): string {
  return JUSTICE_EVIDENCE_TYPE_LABELS[t as JusticeEvidenceType] ?? t.replace(/_/g, " ");
}

function planFinalFollowUpContactMethodLabel(m: JusticeIntake["contact_method"]): string {
  if (!m) return "—";
  switch (m) {
    case "email":
      return "Email";
    case "chat":
      return "Chat";
    case "phone":
      return "Phone";
    case "form":
      return "Web form";
    case "in_person":
      return "In person";
    case "other":
      return "Other";
    default:
      return String(m).replace(/_/g, " ");
  }
}

function planFinalFollowUpOutcomeLabel(t: JusticeIntake["merchant_response_type"]): string {
  if (!t) return "—";
  switch (t) {
    case "no_response":
      return "No response";
    case "refused_help":
      return "Refused help";
    case "promised_but_did_not_fix":
      return "Promised fix but did not follow through";
    case "partial_help":
      return "Partial help";
    case "asked_more_info":
      return "Asked for more information";
    case "other":
      return "Other outcome";
    case "resolved":
      return "Resolved";
    default:
      return String(t).replace(/_/g, " ");
  }
}

/** Deterministic copy-only text for optional last merchant contact before escalation (plan surface only). */
function buildFinalFollowUpNudgeText(intake: JusticeIntake): string {
  const company = intake.company_name.trim() || "the business";
  const subjectLine = intake.purchase_or_signup.trim() || "my issue";
  const story = intake.story.trim();
  const storyPart = story
    ? story.length > 220
      ? `${story.slice(0, 220)}…`
      : story
    : "Describe what is still unresolved — you can expand this on the contact page before sending.";
  const method = planFinalFollowUpContactMethodLabel(intake.contact_method);
  const date = intake.contact_date?.trim() || "—";
  const outcome = planFinalFollowUpOutcomeLabel(intake.merchant_response_type);
  const name = intake.user_display_name.trim() || "—";
  const email = intake.reply_email.trim() || "—";
  return `Dear ${company} Support,

Final follow-up before escalation (this is not your first contact)

I previously reached out (${method}, dated ${date}) and recorded the outcome as: ${outcome}. I am sending one last written request before I pursue outside complaint options.

Re: ${subjectLine}

What I still need resolved:
${storyPart}

Please reply in writing with a concrete remedy or timeline. If I do not receive an acceptable resolution, I will move forward with other consumer channels.

Sincerely,
${name}
${email}`.trim();
}

function truncatePlanEvidenceDescription(text: string | null, max: number): string {
  if (!text?.trim()) return "";
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

function destinationStatusBadgeLabel(status: DestinationStatus): string {
  switch (status) {
    case "recommended":
      return "Recommended";
    case "available":
      return "Available";
    case "later":
      return "Later";
    case "manual":
      return "Manual";
    case "locked":
      return "Locked";
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}

async function logEvent(event_name: string, payload: Record<string, unknown>) {
  try {
    await fetch("/api/justice/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_name, payload }),
    });
  } catch {
    /* ignore */
  }
}

function formatTimelineTs(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function formatFilingDateDisplay(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

const PLAN_FILING_NOTES_PREVIEW_MAX = 120;
const PLAN_FILING_CONFIRM_PREVIEW_MAX = 48;

function truncatePlanFilingSnippet(text: string | null | undefined, max: number): string {
  if (!text?.trim()) return "";
  const trimmed = text.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, max)}…`;
}

/** Prefer formatted date when `filed_at` parses; otherwise show the stored string. */
function planFilingFiledAtLine(filedAt: string): string {
  const t = filedAt.trim();
  const d = new Date(t);
  if (!Number.isNaN(d.getTime())) return formatFilingDateDisplay(t);
  return t;
}

/** Post-review handoff: primary CTA stays on in-app review (packet); optional detail prep route. */
function pickPreparedNextAction(params: {
  contacted: boolean;
  useCompanyContactLabels: boolean;
  destinations: JusticeDestination[];
}): { href: string; detailHref: string | null; buttonLabel: string; stepLabel: string } {
  const { contacted, useCompanyContactLabels, destinations } = params;

  if (!contacted) {
    return {
      href: "/justice/packet",
      detailHref: "/justice/merchant",
      buttonLabel: "Review prepared next step",
      stepLabel: useCompanyContactLabels ? "Company contact" : "Merchant contact",
    };
  }

  const firstRoutableDest = destinations.find(
    (d) =>
      d.internalRoute &&
      (d.status === "recommended" || d.status === "available")
  );

  if (firstRoutableDest?.internalRoute) {
    return {
      href: "/justice/packet",
      detailHref: firstRoutableDest.internalRoute,
      buttonLabel: "Review prepared next step",
      stepLabel: firstRoutableDest.label,
    };
  }

  return {
    href: "/justice/packet",
    detailHref: null,
    buttonLabel: "Review prepared next step",
    stepLabel: "Prepared case review",
  };
}

const PREP_TYPES: TimelineEntryType[] = [
  "state_ag_prep_opened",
  "bbb_prep_opened",
  "cfpb_prep_opened",
  "fcc_prep_opened",
];

const FILED_COMPLAINT_TYPES: TimelineEntryType[] = [
  "state_ag_complaint_filed",
  "bbb_complaint_filed",
  "cfpb_complaint_filed",
  "fcc_complaint_filed",
];

function prepStageLabel(type: TimelineEntryType): string {
  switch (type) {
    case "state_ag_prep_opened":
      return "State AG prep started";
    case "bbb_prep_opened":
      return "BBB prep started";
    case "cfpb_prep_opened":
      return "CFPB prep started";
    case "fcc_prep_opened":
      return "FCC prep started";
    default:
      return "Prep started";
  }
}

function filedComplaintStageLabel(type: TimelineEntryType): string {
  switch (type) {
    case "state_ag_complaint_filed":
      return "State AG complaint filed";
    case "bbb_complaint_filed":
      return "BBB complaint filed";
    case "cfpb_complaint_filed":
      return "CFPB complaint filed";
    case "fcc_complaint_filed":
      return "FCC complaint filed";
    default:
      return "Complaint filed";
  }
}

function filedComplaintTypePriority(t: TimelineEntryType): number {
  switch (t) {
    case "state_ag_complaint_filed":
      return 0;
    case "bbb_complaint_filed":
      return 1;
    case "cfpb_complaint_filed":
      return 2;
    case "fcc_complaint_filed":
      return 3;
    default:
      return 99;
  }
}

/** Latest external complaint filed marker; ties on `ts` use AG > BBB > CFPB > FCC. */
function latestFiledComplaint(entries: TimelineEntry[]): TimelineEntry | undefined {
  const filed = entries.filter((e) => FILED_COMPLAINT_TYPES.includes(e.type));
  if (filed.length === 0) return undefined;
  return [...filed].sort((a, b) => {
    const byTs = b.ts.localeCompare(a.ts);
    if (byTs !== 0) return byTs;
    return filedComplaintTypePriority(a.type) - filedComplaintTypePriority(b.type);
  })[0];
}

function latestByTs(entries: TimelineEntry[]): TimelineEntry | undefined {
  if (entries.length === 0) return undefined;
  return [...entries].sort((a, b) => b.ts.localeCompare(a.ts))[0];
}

/** Furthest meaningful milestone: FTC → external complaint filed (latest) → prep (latest) → escalation → merchant → started. */
function computeTimelineStatusSummary(entries: TimelineEntry[]): string {
  const ftcDone = latestByTs(entries.filter((e) => e.type === "ftc_practice_completed"));
  if (ftcDone) return "FTC practice completed";

  const ftcStart = latestByTs(entries.filter((e) => e.type === "ftc_practice_started"));
  if (ftcStart) return "FTC practice started";

  const latestFiled = latestFiledComplaint(entries);
  if (latestFiled) return filedComplaintStageLabel(latestFiled.type);

  const preps = entries.filter((e) => PREP_TYPES.includes(e.type));
  const latestPrep = latestByTs(preps);
  if (latestPrep) return prepStageLabel(latestPrep.type);

  if (latestByTs(entries.filter((e) => e.type === "escalation_unlocked"))) return "Escalation ready";

  if (latestByTs(entries.filter((e) => e.type === "merchant_contact_saved"))) return "Company contacted";

  if (latestByTs(entries.filter((e) => e.type === "submission_draft_reviewed"))) {
    return "Submission draft reviewed";
  }

  return "Started";
}

function latestTimelineProgressLine(entries: TimelineEntry[]): string | null {
  const latest = latestByTs(entries);
  if (!latest) return null;
  const detail = latest.detail?.trim();
  return detail ? `${latest.label} — ${detail}` : latest.label;
}

function isoToDateInputValue(iso?: string): string {
  if (!iso?.trim()) return "";
  const d = iso.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : "";
}

function hasApprovedNextActionTrackingSummary(action: JusticeApprovedNextAction): boolean {
  return Boolean(action.outcome_note?.trim()) || action.follow_up_needed === true;
}

function ApprovedNextActionTrackingSummary({ action }: { action: JusticeApprovedNextAction }) {
  if (!hasApprovedNextActionTrackingSummary(action)) return null;
  return (
    <div className="mt-2 rounded-lg border border-emerald-400/50 bg-white/60 px-3 py-2 text-xs text-emerald-950 dark:border-emerald-600/40 dark:bg-emerald-950/30 dark:text-emerald-100">
      <p className="font-medium text-emerald-900 dark:text-emerald-50">Tracking note saved</p>
      {action.outcome_note?.trim() ? (
        <p className="mt-1 whitespace-pre-wrap leading-relaxed">{action.outcome_note.trim()}</p>
      ) : null}
      {action.follow_up_needed === true ? (
        <p className="mt-1 text-emerald-800 dark:text-emerald-200">Follow-up needed</p>
      ) : null}
      <ApprovedNextActionFollowUpTimingLine
        followUpAt={action.follow_up_at}
        className="mt-1 text-emerald-800 dark:text-emerald-200"
      />
      {action.follow_up_at?.trim() ? (
        <p className="mt-0.5 text-[11px] text-emerald-800/75 dark:text-emerald-200/75">
          Your chosen date is a tracking aid — move at your own pace.
        </p>
      ) : null}
      <p className="mt-1 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
        In-app tracking only — Surrenderless has not filed, submitted, sent, or contacted anyone.
      </p>
    </div>
  );
}

function ApprovedNextActionOutcomeTrackingForm({
  action,
  onSave,
}: {
  action: JusticeApprovedNextAction;
  onSave: (draft: {
    outcome_note: string;
    follow_up_needed: boolean;
    follow_up_at: string;
  }) => Promise<void>;
}) {
  const [outcomeNote, setOutcomeNote] = useState(action.outcome_note ?? "");
  const [followUpNeeded, setFollowUpNeeded] = useState(action.follow_up_needed === true);
  const [followUpAt, setFollowUpAt] = useState(() => isoToDateInputValue(action.follow_up_at));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setOutcomeNote(action.outcome_note ?? "");
    setFollowUpNeeded(action.follow_up_needed === true);
    setFollowUpAt(isoToDateInputValue(action.follow_up_at));
  }, [action.outcome_note, action.follow_up_needed, action.follow_up_at, action.completed_at]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await onSave({
        outcome_note: outcomeNote,
        follow_up_needed: followUpNeeded,
        follow_up_at: followUpAt,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="mt-3 space-y-2 rounded-lg border border-emerald-400/50 bg-white/70 px-3 py-2.5 dark:border-emerald-600/40 dark:bg-emerald-950/40"
      aria-label="Outcome and follow-up tracking"
    >
      <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">Record outcome / follow-up</p>
      <label className="block text-[11px] font-medium text-emerald-900 dark:text-emerald-200">
        Outcome / note
        <textarea
          value={outcomeNote}
          onChange={(e) => setOutcomeNote(e.target.value)}
          rows={3}
          placeholder="What happened, or what should Surrenderless track next?"
          className="mt-1 w-full resize-y rounded-md border border-emerald-300/80 bg-white px-2 py-1.5 text-xs text-neutral-900 placeholder:text-neutral-400 dark:border-emerald-700 dark:bg-neutral-950 dark:text-neutral-100"
        />
      </label>
      <label className="flex cursor-pointer items-start gap-2 text-[11px] text-emerald-900 dark:text-emerald-100">
        <input
          type="checkbox"
          checked={followUpNeeded}
          onChange={(e) => setFollowUpNeeded(e.target.checked)}
          className="mt-0.5"
        />
        Follow-up needed
      </label>
      {followUpNeeded ? (
        <label className="block text-[11px] font-medium text-emerald-900 dark:text-emerald-200">
          Follow-up date (optional, your pace)
          <input
            type="date"
            value={followUpAt}
            onChange={(e) => setFollowUpAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-emerald-300/80 bg-white px-2 py-1.5 text-xs text-neutral-900 dark:border-emerald-700 dark:bg-neutral-950 dark:text-neutral-100"
          />
          <span className="mt-1 block font-normal text-emerald-800/80 dark:text-emerald-200/75">
            Optional reminder for you — not a deadline.
          </span>
        </label>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="inline-flex rounded-lg border border-emerald-500/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
      >
        {saving ? "Saving…" : "Save tracking note"}
      </button>
      <p className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
        Tracking only — not automatic filing or submission.
      </p>
    </form>
  );
}

function ApprovedNextActionHandlingRequestBlock({
  action,
  onRequest,
  requesting,
}: {
  action: JusticeApprovedNextAction;
  onRequest: () => Promise<void>;
  requesting: boolean;
}) {
  if (action.status === "completed") return null;

  const requestedAt = action.handling_requested_at?.trim();

  return (
    <div
      className="mt-3 rounded-lg border border-emerald-400/50 bg-white/70 px-3 py-2.5 dark:border-emerald-600/40 dark:bg-emerald-950/40"
      aria-label={APPROVED_NEXT_ACTION_HANDLING_TRACKING_ARIA_LABEL}
    >
      {requestedAt ? (
        <>
          <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">
            {APPROVED_NEXT_ACTION_HANDLING_REQUESTED_LABEL}
          </p>
          <p className="mt-1 text-xs text-emerald-900/90 dark:text-emerald-100/90">
            {formatHandlingRecordedLine(requestedAt)}
          </p>
        </>
      ) : (
        <>
          <p className="text-xs font-medium text-emerald-950 dark:text-emerald-100">
            {APPROVED_NEXT_ACTION_HANDLING_TRACKING_SECTION_LABEL}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-emerald-900/90 dark:text-emerald-100/90">
            {APPROVED_NEXT_ACTION_HANDLING_PENDING_DESCRIPTION}
          </p>
          <button
            type="button"
            onClick={() => void onRequest()}
            disabled={requesting}
            className="mt-2 inline-flex rounded-lg border border-emerald-400/80 bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white shadow-sm transition hover:bg-emerald-800 disabled:opacity-60 dark:border-emerald-600/60 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            {requesting
              ? APPROVED_NEXT_ACTION_REQUEST_HANDLING_SAVING_LABEL
              : APPROVED_NEXT_ACTION_REQUEST_HANDLING_BUTTON_LABEL}
          </button>
        </>
      )}
      <p className="mt-2 text-[11px] leading-relaxed text-emerald-800/80 dark:text-emerald-200/80">
        {APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER_WITH_YET}
      </p>
    </div>
  );
}

export default function JusticePlanPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { isSignedIn, isLoaded } = useAuth();
  const [intake, setIntake] = useState<JusticeIntake | null>(null);
  const [caseId, setCaseId] = useState<string>("");
  const [manualFtc, setManualFtc] = useState(false);
  const [ftcCompleted, setFtcCompleted] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const [caseLabel, setCaseLabel] = useState<string | null>(null);
  const [serverPaymentDisputeDraft, setServerPaymentDisputeDraft] = useState<unknown | null>(null);
  const loggedPlan = useRef(false);
  /** True when plan is open only because we expect GET /api/justice/cases/[id] to supply intake. */
  const pendingServerIntakeRef = useRef(false);
  /** Signed-in, no local case id — fetch GET /api/justice/cases to resume latest. */
  const [resumeLatestPending, setResumeLatestPending] = useState(false);
  const [filings, setFilings] = useState<JusticeCaseFilingRow[]>([]);
  const [readinessLoading, setReadinessLoading] = useState(false);
  const [evidenceCount, setEvidenceCount] = useState(0);
  const [evidenceRowsForPlan, setEvidenceRowsForPlan] = useState<JusticeCaseEvidenceRow[]>([]);
  const [tasksForReadiness, setTasksForReadiness] = useState<JusticeCaseTaskRow[]>([]);
  const [readinessTick, setReadinessTick] = useState(0);
  const [preparedPacketApproved, setPreparedPacketApproved] = useState(false);
  const [approvedNextAction, setApprovedNextAction] = useState<JusticeApprovedNextAction | undefined>(
    undefined
  );
  const [requestingHandling, setRequestingHandling] = useState(false);

  useEffect(() => {
    const raw = sessionStorage.getItem(STORAGE_INTAKE);
    const cid = sessionStorage.getItem(STORAGE_CASE_ID) ?? "";
    setCaseId(cid);
    setManualFtc(sessionStorage.getItem(STORAGE_FTC_MANUAL_UNLOCK) === "1");
    setFtcCompleted(sessionStorage.getItem("justice_ftc_mock_completed") === "1");

    let parsed: JusticeIntake | null = null;
    if (raw) {
      try {
        parsed = JSON.parse(raw) as JusticeIntake;
      } catch {
        parsed = null;
      }
    }
    if (parsed) {
      pendingServerIntakeRef.current = false;
      setResumeLatestPending(false);
      setCaseLabel(null);
      setServerPaymentDisputeDraft(null);
      setIntake(parsed);
      setPreparedPacketApproved(resolvePreparedPacketApproved(cid, undefined));
      {
        const resolved = resolveApprovedNextAction(cid, undefined);
        if (resolved) writeSessionApprovedNextAction(cid, resolved);
        setApprovedNextAction(resolved);
      }
      return;
    }

    if (!isLoaded) return;

    if (isSignedIn && cid) {
      pendingServerIntakeRef.current = true;
      setResumeLatestPending(false);
      return;
    }

    if (isSignedIn && !cid) {
      setResumeLatestPending(true);
      return;
    }

    if (!isSignedIn) {
      pendingServerIntakeRef.current = false;
      setResumeLatestPending(false);
      return;
    }
  }, [router, isLoaded, isSignedIn]);

  useEffect(() => {
    if (pathname !== "/justice/plan") return;
    if (!isLoaded || !isSignedIn) return;

    const cid = sessionStorage.getItem(STORAGE_CASE_ID) ?? "";
    if (!cid && !resumeLatestPending) return;

    const ac = new AbortController();

    if (cid) {
      void (async () => {
        try {
          const res = await fetch(`/api/justice/cases/${encodeURIComponent(cid)}`, {
            signal: ac.signal,
          });
          if (!res.ok) {
            console.warn("justice plan: GET /api/justice/cases/[id] failed", res.status);
            if (pendingServerIntakeRef.current) {
              pendingServerIntakeRef.current = false;
              router.replace("/justice");
            }
            return;
          }
          const data = (await res.json()) as {
            id?: string;
            intake?: JusticeIntake;
            timeline?: unknown;
            case_label?: string | null;
            payment_dispute_draft?: unknown;
            client_state?: unknown;
          };
          if (ac.signal.aborted) return;
          if (!data?.id || !data.intake) {
            console.warn("justice plan: case hydrate response missing id or intake");
            if (pendingServerIntakeRef.current) {
              pendingServerIntakeRef.current = false;
              router.replace("/justice");
            }
            return;
          }
          if (data.id !== cid) {
            console.warn("justice plan: case id mismatch from server");
            if (pendingServerIntakeRef.current) {
              pendingServerIntakeRef.current = false;
              router.replace("/justice");
            }
            return;
          }
          pendingServerIntakeRef.current = false;
          sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(data.intake));
          const serverTimeline = Array.isArray(data.timeline) ? (data.timeline as TimelineEntry[]) : [];
          replaceTimelineForCase(cid, serverTimeline);
          setCaseLabel(data.case_label ?? null);
          setServerPaymentDisputeDraft(
            data.payment_dispute_draft !== undefined ? data.payment_dispute_draft : null
          );
          setIntake(data.intake);
          setCaseId(cid);
          setTimeline(readTimeline(cid));
          setPreparedPacketApproved(resolvePreparedPacketApproved(cid, data.client_state));
          {
            const resolved = resolveApprovedNextAction(cid, data.client_state);
            if (resolved) writeSessionApprovedNextAction(cid, resolved);
            setApprovedNextAction(resolved);
          }
        } catch (e) {
          if (ac.signal.aborted) return;
          console.warn("justice plan: GET /api/justice/cases/[id] error", e);
          if (pendingServerIntakeRef.current) {
            pendingServerIntakeRef.current = false;
            router.replace("/justice");
          }
        }
      })();

      return () => ac.abort();
    }

    if (!resumeLatestPending) return;

    void (async () => {
      try {
        const res = await fetch("/api/justice/cases", { signal: ac.signal });
        if (!res.ok) {
          console.warn("justice plan: GET /api/justice/cases failed", res.status);
          setResumeLatestPending(false);
          router.replace("/justice");
          return;
        }
        const body = (await res.json()) as unknown;
        const env = parseJusticeCasesListEnvelope(body);
        const list = env?.cases ?? [];
        if (ac.signal.aborted) return;
        if (!Array.isArray(list) || list.length === 0) {
          setResumeLatestPending(false);
          router.replace("/justice");
          return;
        }
        const latest = list[0] as {
          id?: string;
          intake?: JusticeIntake;
          timeline?: unknown;
          case_label?: string | null;
          payment_dispute_draft?: unknown;
          client_state?: unknown;
        };
        if (!latest?.id || !latest.intake) {
          console.warn("justice plan: list response missing id or intake");
          setResumeLatestPending(false);
          router.replace("/justice");
          return;
        }
        sessionStorage.setItem(STORAGE_CASE_ID, latest.id);
        sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(latest.intake));
        const serverTimeline = Array.isArray(latest.timeline) ? (latest.timeline as TimelineEntry[]) : [];
        replaceTimelineForCase(latest.id, serverTimeline);
        pendingServerIntakeRef.current = false;
        setResumeLatestPending(false);
        setCaseLabel(latest.case_label ?? null);
        setServerPaymentDisputeDraft(
          latest.payment_dispute_draft !== undefined ? latest.payment_dispute_draft : null
        );
        setIntake(latest.intake);
        setCaseId(latest.id);
        setTimeline(readTimeline(latest.id));
        setPreparedPacketApproved(
          resolvePreparedPacketApproved(latest.id, latest.client_state)
        );
        {
          const resolved = resolveApprovedNextAction(latest.id, latest.client_state);
          if (resolved) writeSessionApprovedNextAction(latest.id, resolved);
          setApprovedNextAction(resolved);
        }
      } catch (e) {
        if (ac.signal.aborted) return;
        console.warn("justice plan: GET /api/justice/cases error", e);
        setResumeLatestPending(false);
        router.replace("/justice");
      }
    })();

    return () => ac.abort();
  }, [pathname, isLoaded, isSignedIn, router, resumeLatestPending]);

  useEffect(() => {
    if (!intake || loggedPlan.current) return;
    loggedPlan.current = true;
    const cid = caseId || sessionStorage.getItem(STORAGE_CASE_ID);
    const manual = typeof window !== "undefined" && sessionStorage.getItem(STORAGE_FTC_MANUAL_UNLOCK) === "1";
    void logEvent("action_plan_generated", {
      case_id: cid,
      payment_available: paymentDisputeAvailable(intake),
      ftc_unlocked: computeFtcUnlocked(intake, manual),
    });
  }, [intake, caseId]);

  useEffect(() => {
    if (!intake) return;
    const cid = caseId || sessionStorage.getItem(STORAGE_CASE_ID) || "";
    if (!cid) return;
    if (intake.already_contacted === "yes" && cfpbPrepDocumentedFromIntake(intake)) {
      appendMerchantContactSavedOnce(cid, intake);
      appendEscalationUnlockedFromMerchantSaveOnce(cid, intake);
    }
    appendActionPlanViewedOnce(cid);
    setTimeline(readTimeline(cid));
  }, [intake, caseId, pathname]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) {
      setFilings([]);
      setEvidenceCount(0);
      setEvidenceRowsForPlan([]);
      setTasksForReadiness([]);
      setReadinessLoading(false);
      return;
    }
    const cid = caseId || sessionStorage.getItem(STORAGE_CASE_ID) || "";
    if (!cid) {
      setFilings([]);
      setEvidenceCount(0);
      setEvidenceRowsForPlan([]);
      setTasksForReadiness([]);
      setReadinessLoading(false);
      return;
    }
    let cancelled = false;
    setReadinessLoading(true);
    void (async () => {
      try {
        const [filRes, evRes, taskRes] = await Promise.all([
          fetch(`/api/justice/filings?case_id=${encodeURIComponent(cid)}`),
          fetch(`/api/justice/evidence?case_id=${encodeURIComponent(cid)}`),
          fetch(`/api/justice/tasks?case_id=${encodeURIComponent(cid)}`),
        ]);
        if (cancelled) return;
        const filJson: unknown = filRes.ok ? await filRes.json() : [];
        const evJson: unknown = evRes.ok ? await evRes.json() : [];
        const taskJson: unknown = taskRes.ok ? await taskRes.json() : [];
        setFilings(Array.isArray(filJson) ? (filJson as JusticeCaseFilingRow[]) : []);
        const evRows = Array.isArray(evJson) ? (evJson as JusticeCaseEvidenceRow[]) : [];
        setEvidenceCount(evRows.length);
        setEvidenceRowsForPlan(evRows);
        setTasksForReadiness(Array.isArray(taskJson) ? (taskJson as JusticeCaseTaskRow[]) : []);
      } catch {
        if (!cancelled) {
          setFilings([]);
          setEvidenceCount(0);
          setEvidenceRowsForPlan([]);
          setTasksForReadiness([]);
        }
      } finally {
        if (!cancelled) setReadinessLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, caseId, pathname, readinessTick]);

  const caseSummaryTitle = useMemo(() => {
    if (!intake) return "";
    const label = caseLabel?.trim();
    if (label) return label;
    const po = intake.purchase_or_signup.trim();
    if (!po) return intake.company_name;
    return `${intake.company_name} — ${po.slice(0, 80)}${po.length > 80 ? "…" : ""}`;
  }, [intake, caseLabel]);

  const timelineStatus = useMemo(() => computeTimelineStatusSummary(timeline), [timeline]);

  const progressLine = useMemo(() => latestTimelineProgressLine(timeline), [timeline]);

  const showPostDraftReviewCallout = useMemo(() => {
    if (!intake) return false;
    if (isMerchantResolved(intake)) return false;
    const hasReview = timeline.some((e) => e.type === "submission_draft_reviewed");
    if (!hasReview) return false;
    const movedOn =
      timeline.some((e) => PREP_TYPES.includes(e.type)) ||
      timeline.some((e) => FILED_COMPLAINT_TYPES.includes(e.type)) ||
      timeline.some((e) => e.type === "ftc_practice_completed");
    return !movedOn;
  }, [timeline, intake]);

  const paymentDraftUi = useMemo((): { detail?: string } | null => {
    const cid = caseId || (typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID) : null) || "";
    if (!cid) return null;

    if (serverPaymentDisputeDraft != null) {
      if (typeof serverPaymentDisputeDraft !== "object" || Array.isArray(serverPaymentDisputeDraft)) return null;
      if (Object.keys(serverPaymentDisputeDraft as object).length === 0) return null;
      const d = serverPaymentDisputeDraft as { merchant_name?: string; charge_amount?: string };
      const bits = [d.merchant_name?.trim(), d.charge_amount?.trim()].filter(Boolean);
      return bits.length ? { detail: bits.join(" · ") } : {};
    }

    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem(STORAGE_PAYMENT_DISPUTE_CHECKLIST_DRAFT_V1);
      if (!raw) return null;
      const d = JSON.parse(raw) as { case_id?: string; merchant_name?: string; charge_amount?: string };
      if (d.case_id !== cid) return null;
      const bits = [d.merchant_name?.trim(), d.charge_amount?.trim()].filter(Boolean);
      return bits.length ? { detail: `${bits.join(" · ")} (on this device)` } : {};
    } catch {
      return null;
    }
  }, [caseId, serverPaymentDisputeDraft]);

  const planLatestFiling = filings.length > 0 ? filings[0] : undefined;
  const planLatestFilingDateText =
    planLatestFiling != null ? formatFilingDateDisplay(planLatestFiling.filed_at ?? planLatestFiling.created_at) : null;
  const planLatestConfirmation = planLatestFiling?.confirmation_number?.trim() || null;

  const openTaskCount = useMemo(
    () => tasksForReadiness.filter((t) => !t.completed_at).length,
    [tasksForReadiness]
  );

  const merchantSuggestedMessageFull = useMemo(
    () => (intake ? buildMerchantMessage(intake) : ""),
    [intake]
  );

  const paymentDisputePreviewLetterFull = useMemo(() => {
    if (!intake || !paymentDisputeAvailable(intake)) return "";
    const cid =
      caseId ||
      (typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID) ?? "" : "");
    const draft = buildDefaultPaymentDisputeDraft(cid || "local", intake);
    return buildPaymentDisputeBankLetter(draft, intake);
  }, [intake, caseId]);

  const basicsReady = intake ? isBasicCaseInfoReadyForEscalation(intake) : false;
  const evidenceReady = evidenceCount >= 1;
  const readyToEscalate = basicsReady && evidenceReady;

  if (!intake) {
    if (isLoaded && !isSignedIn) {
      return (
        <>
          <Header />
          <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
            <p className="text-sm text-neutral-600 dark:text-neutral-400">
              <Link href="/" className="text-blue-600 hover:underline">
                Home
              </Link>
            </p>
            <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Your action plan</h1>
            <p className="mt-4 text-sm text-neutral-700 dark:text-neutral-300">Sign in to resume saved cases.</p>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <SignInButton mode="modal">
                <button
                  type="button"
                  className="rounded-xl bg-neutral-800 px-4 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-neutral-900 dark:bg-neutral-200 dark:text-neutral-900 dark:hover:bg-white"
                >
                  Sign in
                </button>
              </SignInButton>
              <Link
                href="/justice"
                className="inline-flex justify-center rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-center text-sm font-semibold text-neutral-900 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
              >
                Start a new case
              </Link>
            </div>
          </main>
        </>
      );
    }
    return (
      <>
        <Header />
        <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-neutral-50 to-neutral-100/80 p-6 text-neutral-500 dark:from-neutral-950 dark:to-neutral-900 dark:text-neutral-400">
          Loading…
        </main>
      </>
    );
  }

  const paymentOk = paymentDisputeAvailable(intake);
  const ftcOpen = computeFtcUnlocked(intake, manualFtc);
  const contacted = intake.already_contacted === "yes";
  const merchantResolved = isMerchantResolved(intake);
  const cfpbRel = cfpbLikelyRelevant(intake);
  const fccRel = fccLikelyRelevant(intake);
  const dotRel = dotLikelyRelevant(intake);
  const useCompanyContactLabels = cfpbRel || fccRel || dotRel;
  const cfpbPrepOpen = cfpbRel && cfpbPrepUnlockedFromIntake(intake, manualFtc);
  const step3ContactLockMessage = useCompanyContactLabels
    ? "Complete company contact first or provide failed-contact proof."
    : "Complete merchant contact first or provide failed-contact proof.";
  const strengthenProofHint = useCompanyContactLabels
    ? "Recommended next: strengthen your company contact proof."
    : "Recommended next: strengthen your merchant contact proof.";
  const ftcPracticeDoneVisible = ftcCompleted && ftcOpen;

  const headline = `${intake.company_name} — ${intake.purchase_or_signup.slice(0, 80)}${intake.purchase_or_signup.length > 80 ? "…" : ""}`;
  const recommendationText =
    ftcPracticeDoneVisible && !cfpbRel && !fccRel && dotRel
      ? "FTC practice completed. Next: prepare your DOT aviation complaint draft (manual prep only; file on the official USDOT process when ready), or consider a payment dispute if money is still lost."
      : ftcPracticeDoneVisible && !cfpbRel && !fccRel
        ? "FTC practice completed. Next: consider payment dispute if money is still lost."
        : merchantResolved
          ? "You marked this as resolved with the merchant. Keep any confirmations for your records."
          : !contacted
            ? "Recommended next: contact the company first."
            : cfpbRel
              ? cfpbPrepOpen
                ? "Recommended next: prepare your CFPB complaint (file manually on the official CFPB site when ready)."
                : strengthenProofHint
              : fccRel
                ? ftcOpen
                  ? "Recommended next: prepare your FCC complaint (file manually on the official FCC site when ready)."
                  : strengthenProofHint
                : dotRel
                  ? ftcOpen
                    ? "Recommended next: prepare your DOT aviation complaint draft (manual prep here; file on the official USDOT aviation consumer process when ready)."
                    : strengthenProofHint
                  : ftcOpen
                    ? "Recommended next: escalate using your failed contact proof."
                    : strengthenProofHint;
  const paymentRecommendedNext = ftcPracticeDoneVisible && paymentOk;
  const merchantBadge =
    !merchantResolved &&
    (!contacted || (contacted && !ftcOpen) || (cfpbRel && contacted && !cfpbPrepOpen)) &&
    !paymentRecommendedNext;
  const finalFollowUpPreviewVisible =
    contacted && ftcOpen && !merchantResolved && !merchantBadge;
  const merchantTitle = merchantResolved
    ? "Merchant contact — resolved"
    : !contacted
      ? "Step 1 — Contact the company"
      : cfpbRel && !cfpbPrepOpen
        ? useCompanyContactLabels
          ? "Recommended — Update company contact record"
          : "Recommended — Update merchant contact record"
        : ftcOpen
          ? useCompanyContactLabels
            ? "Optional — Send one final company follow-up"
            : "Optional — Send one final merchant follow-up"
          : "Recommended — Final merchant follow-up";
  const merchantDescription = merchantResolved
    ? "You indicated the merchant fixed or resolved your issue. You can update your contact record if something changes."
    : !contacted
      ? "This creates proof and often fixes the issue fastest."
      : cfpbRel && !cfpbPrepOpen
        ? useCompanyContactLabels
          ? "Add or fix contact details (including notes if you have no written proof) so CFPB prep can unlock."
          : "Add or fix contact details so CFPB prep can unlock."
        : ftcOpen
          ? "Use this only if you want one stronger written attempt before escalating."
          : "Send one clear written request and save proof before escalation.";

  const destinations = computeJusticeDestinations(intake, { manualFtc, useCompanyContactLabels });

  const preparedNextAction = pickPreparedNextAction({
    contacted,
    useCompanyContactLabels,
    destinations,
  });

  const approvedStepLabel =
    preparedPacketApproved && approvedNextAction?.label
      ? approvedNextAction.label
      : preparedNextAction.stepLabel;
  const approvedStepHref =
    preparedPacketApproved && approvedNextAction?.href
      ? approvedNextAction.href
      : preparedNextAction.detailHref;
  const approvedNextActionCompleted = approvedNextAction?.status === "completed";
  const approvedNextActionStarted = approvedNextAction?.status === "started";
  const showApprovedNextActionCta =
    preparedPacketApproved && approvedNextAction && approvedStepHref && !approvedNextActionCompleted;

  async function persistApprovedNextAction(next: JusticeApprovedNextAction) {
    if (caseId) writeSessionApprovedNextAction(caseId, next);
    setApprovedNextAction(next);
    setPreparedPacketApproved(true);
    if (isLoaded && isSignedIn && caseId && isUuid(caseId)) {
      await persistApprovedNextActionClientState(caseId, next);
    }
  }

  async function handleMarkApprovedNextActionHandled() {
    if (!approvedNextAction || approvedNextAction.status !== "started") return;
    const next: JusticeApprovedNextAction = {
      ...approvedNextAction,
      status: "completed",
      completed_at: new Date().toISOString(),
    };
    await persistApprovedNextAction(next);
  }

  async function handleSaveApprovedNextActionTracking(draft: {
    outcome_note: string;
    follow_up_needed: boolean;
    follow_up_at: string;
  }) {
    if (!approvedNextAction || approvedNextAction.status !== "completed") return;
    const trimmedNote = draft.outcome_note.trim();
    const next: JusticeApprovedNextAction = { ...approvedNextAction };
    if (trimmedNote) next.outcome_note = trimmedNote;
    else delete next.outcome_note;
    if (draft.follow_up_needed) {
      next.follow_up_needed = true;
      if (draft.follow_up_at.trim()) {
        next.follow_up_at = new Date(`${draft.follow_up_at}T12:00:00`).toISOString();
      } else {
        delete next.follow_up_at;
      }
    } else {
      delete next.follow_up_needed;
      delete next.follow_up_at;
    }
    await persistApprovedNextAction(next);
  }

  async function handleRequestSurrenderlessHandling() {
    if (!approvedNextAction || approvedNextAction.status === "completed") return;
    if (approvedNextAction.handling_requested_at?.trim()) return;
    setRequestingHandling(true);
    try {
      const next: JusticeApprovedNextAction = {
        ...approvedNextAction,
        handling_requested_at: new Date().toISOString(),
      };
      await persistApprovedNextAction(next);
    } finally {
      setRequestingHandling(false);
    }
  }

  async function handleViewApprovedCasePacketClick() {
    if (approvedNextActionCompleted) {
      router.push(approvedNextAction?.href ?? preparedNextAction.href ?? "/justice/packet");
      return;
    }
    const label = approvedNextAction?.label ?? approvedStepLabel;
    const href = approvedNextAction?.href ?? preparedNextAction.href ?? "/justice/packet";
    const next: JusticeApprovedNextAction = {
      ...(approvedNextAction ?? {}),
      ...(label ? { label } : {}),
      href,
      status: "started",
      started_at: approvedNextAction?.started_at ?? new Date().toISOString(),
      ...(approvedNextAction?.approved_at ? { approved_at: approvedNextAction.approved_at } : {}),
    };

    if (caseId) {
      try {
        const raw = sessionStorage.getItem(STORAGE_PREPARED_PACKET_APPROVED_V1);
        const map: Record<string, boolean> = raw
          ? (JSON.parse(raw) as Record<string, boolean>)
          : {};
        map[caseId] = true;
        sessionStorage.setItem(STORAGE_PREPARED_PACKET_APPROVED_V1, JSON.stringify(map));
      } catch {
        // ignore corrupt session data
      }
    }

    await persistApprovedNextAction(next);
    router.push(next.href || "/justice/packet");
  }

  async function handleApprovedNextActionOpen(href: string) {
    if (approvedNextActionCompleted) {
      router.push(href || approvedNextAction?.href || "/justice/packet");
      return;
    }
    const label = approvedNextAction?.label ?? approvedStepLabel;
    const targetHref = href || approvedNextAction?.href || "/justice/packet";
    const next: JusticeApprovedNextAction = {
      ...(approvedNextAction ?? {}),
      ...(label ? { label } : {}),
      href: approvedNextAction?.href ?? targetHref,
      status: "started",
      started_at: approvedNextAction?.started_at ?? new Date().toISOString(),
      ...(approvedNextAction?.approved_at ? { approved_at: approvedNextAction.approved_at } : {}),
    };

    if (caseId) {
      try {
        const raw = sessionStorage.getItem(STORAGE_PREPARED_PACKET_APPROVED_V1);
        const map: Record<string, boolean> = raw
          ? (JSON.parse(raw) as Record<string, boolean>)
          : {};
        map[caseId] = true;
        sessionStorage.setItem(STORAGE_PREPARED_PACKET_APPROVED_V1, JSON.stringify(map));
      } catch {
        // ignore corrupt session data
      }
    }

    await persistApprovedNextAction(next);
    router.push(targetHref);
  }

  /** Styling mirror of “Recommended next” visibility on the Step 3 `<li>` (no logic changes). */
  const step3RecommendedCardHighlight =
    !merchantResolved &&
    (cfpbRel
      ? contacted && cfpbPrepOpen
      : fccRel
        ? contacted && ftcOpen
        : dotRel
          ? contacted && ftcOpen
          : !ftcPracticeDoneVisible && contacted && ftcOpen);

  const mainDestinationLiBaseCls =
    "rounded-2xl p-5 shadow-lg shadow-neutral-900/5 transition-shadow duration-200 hover:shadow-xl hover:shadow-neutral-900/[0.07] dark:shadow-black/40 dark:hover:shadow-black/50";
  const mainDestinationLiNeutralCls = `${mainDestinationLiBaseCls} border border-neutral-200/90 bg-white ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:ring-white/[0.06]`;
  const mainDestinationLiRecommendedCls = `${mainDestinationLiBaseCls} border border-blue-200/80 bg-blue-50/40 ring-2 ring-blue-500/20 dark:border-blue-800/60 dark:bg-blue-950/40 dark:ring-blue-400/20`;

  const summaryCardCls =
    "mt-4 rounded-xl border border-neutral-200/90 bg-white px-4 py-4 text-sm leading-relaxed shadow-sm ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:ring-white/[0.06]";

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/justice/chat-ai" className="text-blue-600 hover:underline">
            Update in chat
          </Link>
          {" · "}
          <Link href="/justice/intake" className="text-blue-600 hover:underline">
            Edit structured form
          </Link>
          {" · "}
          <Link href="/justice/cases" className="text-blue-600 hover:underline">
            Saved cases
          </Link>
          {" · "}
          <Link
            href="/justice"
            onClick={() => clearLocalJusticeSession()}
            className="text-blue-600 hover:underline"
          >
            Start new case
          </Link>
          {" · "}
          <Link href="/" className="text-blue-600 hover:underline">
            Home
          </Link>
        </p>

        <h1 className="mt-2 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Your action plan</h1>

        {showPostDraftReviewCallout ? (
          <div
            className="mt-4 rounded-xl border border-emerald-200/90 bg-emerald-50/80 px-4 py-4 text-sm shadow-sm ring-1 ring-emerald-950/[0.05] dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:ring-emerald-400/10"
            role="status"
            aria-label="Prepared next step from reviewed draft"
          >
            {preparedPacketApproved ? (
              <div
                className="mb-3 rounded-lg border border-emerald-300/80 bg-emerald-50/90 px-3 py-2.5 ring-1 ring-emerald-600/15 dark:border-emerald-700/80 dark:bg-emerald-950/40 dark:ring-emerald-400/15"
                role="status"
              >
                <p className="font-semibold text-emerald-950 dark:text-emerald-100">
                  {approvedNextActionCompleted
                    ? "Next action recorded as handled"
                    : approvedNextActionStarted
                      ? "Next action started"
                      : "Prepared packet approved for next action"}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-emerald-900/90 dark:text-emerald-100/90">
                  {approvedNextActionCompleted ? (
                    <>
                      You recorded that your approved next step was handled for now
                      {approvedNextAction?.label ? (
                        <>
                          {" "}
                          (<strong>{approvedNextAction.label}</strong>)
                        </>
                      ) : null}
                      . This is in-app tracking only — Surrenderless has not filed, submitted, sent, or contacted
                      anyone on your behalf.
                    </>
                  ) : approvedNextActionStarted ? (
                    <>
                      You opened your approved next in-app step
                      {approvedNextAction?.label ? (
                        <>
                          {" "}
                          (<strong>{approvedNextAction.label}</strong>)
                        </>
                      ) : null}
                      . Surrenderless has not filed, submitted, sent, or contacted anyone on your behalf.
                    </>
                  ) : (
                    <>
                      You reviewed and approved your prepared case packet
                      {approvedNextAction?.label ? (
                        <>
                          {" "}
                          for <strong>{approvedNextAction.label}</strong>
                        </>
                      ) : null}
                      . Surrenderless has not filed, submitted, sent, or contacted anyone on your behalf.
                    </>
                  )}
                </p>
                {approvedNextActionStarted ? (
                  <>
                    <p className="mt-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                      Opened for next step.
                    </p>
                    <button
                      type="button"
                      onClick={() => void handleMarkApprovedNextActionHandled()}
                      className="mt-2 inline-flex rounded-lg border border-emerald-400/80 bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-900 shadow-sm transition hover:bg-emerald-50 dark:border-emerald-600/60 dark:bg-emerald-950/50 dark:text-emerald-100 dark:hover:bg-emerald-900/60"
                    >
                      Record action handled for now
                    </button>
                    <p className="mt-1.5 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                      Tracking only — not automatic filing or submission.
                    </p>
                  </>
                ) : null}
                {approvedNextAction && !approvedNextActionCompleted ? (
                  <ApprovedNextActionHandlingRequestBlock
                    action={approvedNextAction}
                    onRequest={handleRequestSurrenderlessHandling}
                    requesting={requestingHandling}
                  />
                ) : null}
                {approvedNextActionCompleted && approvedNextAction ? (
                  <>
                    <ApprovedNextActionTrackingSummary action={approvedNextAction} />
                    <ApprovedNextActionOutcomeTrackingForm
                      action={approvedNextAction}
                      onSave={handleSaveApprovedNextActionTracking}
                    />
                  </>
                ) : null}
              </div>
            ) : null}
            <p className="font-semibold text-emerald-950 dark:text-emerald-100">
              Surrenderless prepared your next step
            </p>
            <p className="mt-2 leading-relaxed text-emerald-900/95 dark:text-emerald-100/95">
              {preparedPacketApproved
                ? approvedNextActionCompleted
                  ? "Your prepared case packet is approved and your next in-app step is recorded as handled for now."
                  : approvedNextActionStarted
                    ? "Your prepared case packet is approved and your next in-app step is started."
                    : "Your prepared case packet is approved. Continue with the next in-app step below when you are ready."
                : "From your reviewed submission draft, Surrenderless assembled your case for in-app review. Your current focus is"}{" "}
              {!preparedPacketApproved ? (
                <>
                  <strong>{preparedNextAction.stepLabel}</strong> — open your prepared review below when you are ready.
                </>
              ) : (
                <>
                  Approved next step: <strong>{approvedStepLabel}</strong>
                  {approvedNextActionCompleted
                    ? " (recorded as handled)."
                    : approvedNextActionStarted
                      ? " (started)."
                      : "."}
                </>
              )}{" "}
              Nothing has been filed automatically, and Surrenderless has not submitted, filed, or contacted anyone on
              your behalf.
            </p>
            {preparedPacketApproved ? (
              <button
                type="button"
                onClick={() => void handleViewApprovedCasePacketClick()}
                className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-900/20 transition hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                {approvedNextActionCompleted
                  ? "View case packet"
                  : approvedNextActionStarted
                    ? "Continue approved case packet"
                    : "View approved case packet"}
              </button>
            ) : (
              <Link
                href={preparedNextAction.href}
                className="mt-4 inline-flex w-full items-center justify-center rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-900/20 transition hover:bg-emerald-800 dark:bg-emerald-600 dark:hover:bg-emerald-500"
              >
                {preparedNextAction.buttonLabel}
              </Link>
            )}
            {approvedStepHref ? (
              showApprovedNextActionCta && !approvedNextActionStarted && !approvedNextActionCompleted ? (
                approvedStepHref !== preparedNextAction.href ? (
                  <button
                    type="button"
                    onClick={() => void handleApprovedNextActionOpen(approvedStepHref)}
                    className="mt-3 inline-flex text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                  >
                    {approvedNextAction?.label
                      ? `Open ${approvedNextAction.label}`
                      : `Open ${preparedNextAction.stepLabel} preparation`}
                  </button>
                ) : null
              ) : (
                <Link
                  href={approvedStepHref}
                  className="mt-3 inline-flex text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                >
                  Open {preparedNextAction.stepLabel} preparation
                </Link>
              )
            ) : null}
            <p className="mt-3 text-xs text-emerald-800/85 dark:text-emerald-200/85">
              Your full action plan, prep pages, and filing records remain below if you need them.
            </p>
          </div>
        ) : preparedPacketApproved ? (
          <div
            className="mt-4 rounded-xl border border-emerald-200/90 bg-emerald-50/80 px-4 py-3 text-sm shadow-sm ring-1 ring-emerald-950/[0.05] dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:ring-emerald-400/10"
            role="status"
          >
            <p className="font-semibold text-emerald-950 dark:text-emerald-100">
              {approvedNextActionCompleted
                ? "Next action recorded as handled"
                : approvedNextActionStarted
                  ? "Next action started"
                  : "Prepared packet approved for next action"}
            </p>
            <p className="mt-1.5 text-emerald-900/90 dark:text-emerald-100/90">
              {approvedNextActionCompleted ? (
                <>
                  You recorded that your approved next step was handled for now
                  {approvedNextAction?.label ? (
                    <>
                      {" "}
                      (<strong>{approvedNextAction.label}</strong>)
                    </>
                  ) : null}
                  . This is in-app tracking only — Surrenderless has not filed, submitted, sent, or contacted anyone
                  on your behalf.
                </>
              ) : approvedNextActionStarted ? (
                <>
                  You opened your approved next in-app step
                  {approvedNextAction?.label ? (
                    <>
                      {" "}
                      (<strong>{approvedNextAction.label}</strong>)
                    </>
                  ) : null}
                  . Surrenderless has not filed, submitted, sent, or contacted anyone on your behalf.
                </>
              ) : (
                <>
                  You approved your prepared case packet
                  {approvedNextAction?.label ? (
                    <>
                      {" "}
                      for <strong>{approvedNextAction.label}</strong>
                    </>
                  ) : null}
                  . Surrenderless has not filed, submitted, sent, or contacted anyone on your behalf. Use the action
                  plan below for your next steps.
                </>
              )}
            </p>
            {approvedNextActionStarted ? (
              <>
                <p className="mt-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                  Opened for next step.
                </p>
                <button
                  type="button"
                  onClick={() => void handleMarkApprovedNextActionHandled()}
                  className="mt-2 inline-flex rounded-lg border border-emerald-400/80 bg-white/80 px-3 py-1.5 text-xs font-medium text-emerald-900 shadow-sm transition hover:bg-emerald-50 dark:border-emerald-600/60 dark:bg-emerald-950/50 dark:text-emerald-100 dark:hover:bg-emerald-900/60"
                >
                  Record action handled for now
                </button>
                <p className="mt-1.5 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                  Tracking only — not automatic filing or submission.
                </p>
              </>
            ) : null}
            {approvedNextAction && !approvedNextActionCompleted ? (
              <ApprovedNextActionHandlingRequestBlock
                action={approvedNextAction}
                onRequest={handleRequestSurrenderlessHandling}
                requesting={requestingHandling}
              />
            ) : null}
            {approvedNextActionCompleted && approvedNextAction ? (
              <>
                <ApprovedNextActionTrackingSummary action={approvedNextAction} />
                <ApprovedNextActionOutcomeTrackingForm
                  action={approvedNextAction}
                  onSave={handleSaveApprovedNextActionTracking}
                />
              </>
            ) : null}
            {showApprovedNextActionCta && !approvedNextActionStarted && !approvedNextActionCompleted ? (
              <button
                type="button"
                onClick={() => void handleApprovedNextActionOpen(approvedStepHref)}
                className="mt-2 inline-flex text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
              >
                {approvedNextAction?.label
                  ? `Open ${approvedNextAction.label}`
                  : `Open ${preparedNextAction.stepLabel} preparation`}
              </button>
            ) : null}
            {approvedNextActionStarted || approvedNextActionCompleted ? (
              <button
                type="button"
                onClick={() => void handleViewApprovedCasePacketClick()}
                className="mt-2 inline-flex text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
              >
                View case packet
              </button>
            ) : (
              <Link
                href="/justice/packet"
                className={`${showApprovedNextActionCta && !approvedNextActionStarted && !approvedNextActionCompleted ? "mt-2 ml-4" : "mt-2"} inline-flex text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100`}
              >
                View case packet
              </Link>
            )}
          </div>
        ) : null}

        <section className={summaryCardCls} aria-label="Current case summary">
          <p className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Current case</p>
          <p className="mt-2 text-base font-semibold text-neutral-900 dark:text-neutral-100">{caseSummaryTitle}</p>
          <div className="mt-4 space-y-3 text-neutral-700 dark:text-neutral-300">
            <div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Company</p>
              <p className="mt-1 font-medium text-neutral-900 dark:text-neutral-100">{intake.company_name}</p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Issue or product</p>
              <p className="mt-1 font-medium text-neutral-900 dark:text-neutral-100">
                {intake.purchase_or_signup.trim() || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Money involved</p>
              <p className="mt-1 font-medium text-neutral-900 dark:text-neutral-100">
                {intake.money_involved.trim() || "—"}
              </p>
            </div>
            <div>
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Where you are now</p>
              <p className="mt-1 font-medium text-neutral-900 dark:text-neutral-100">{timelineStatus}</p>
            </div>
            {progressLine ? (
              <div className="border-t border-neutral-100 pt-3 dark:border-neutral-700">
                <p className="text-xs text-neutral-500 dark:text-neutral-400">Latest update</p>
                <p className="mt-1 text-neutral-800 dark:text-neutral-200">{progressLine}</p>
              </div>
            ) : null}
            {paymentDraftUi ? (
              <div className="border-t border-neutral-100 pt-3 dark:border-neutral-700">
                <p className="font-medium text-neutral-900 dark:text-neutral-100">Payment dispute draft saved</p>
                {paymentDraftUi.detail ? (
                  <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{paymentDraftUi.detail}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>

        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{headline}</p>
        <div
          className="mt-4 rounded-xl border border-neutral-200/90 bg-neutral-50/90 px-4 py-3 shadow-inner ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-800/40 dark:ring-white/[0.06]"
          aria-labelledby="plan-recommended-next-heading"
        >
          <p
            id="plan-recommended-next-heading"
            className="text-xs font-semibold uppercase tracking-wide text-blue-600 dark:text-blue-400"
          >
            Recommended next
          </p>
          <p className="mt-2 text-sm font-medium text-neutral-800 dark:text-neutral-200">{recommendationText}</p>
        </div>

        <section
          className="mt-6 rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06]"
          aria-labelledby="case-readiness-heading"
        >
          <h2 id="case-readiness-heading" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Case readiness
          </h2>
          {!isSignedIn ? (
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              Sign in to load saved evidence, filings, and tasks for this case.
            </p>
          ) : readinessLoading ? (
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Loading checklist…</p>
          ) : (
            <>
              <ul className="mt-3 space-y-2.5 text-sm text-neutral-800 dark:text-neutral-200">
                <li className="flex gap-2">
                  <span className={basicsReady ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                    {basicsReady ? "✓" : "○"}
                  </span>
                  <span>
                    Basic case info present (company, issue category, product/service, what happened, requested
                    resolution).
                  </span>
                </li>
                <li className="flex gap-2">
                  <span className={evidenceReady ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                    {evidenceReady ? "✓" : "○"}
                  </span>
                  <span>Evidence added: {evidenceCount >= 1 ? "at least 1 saved item" : "none yet"}</span>
                </li>
                <li className="flex gap-2">
                  <span className={filings.length >= 1 ? "text-emerald-600 dark:text-emerald-400" : "text-amber-600 dark:text-amber-400"}>
                    {filings.length >= 1 ? "✓" : "○"}
                  </span>
                  <span>Filing recorded: {filings.length === 0 ? "none" : filings.length === 1 ? "1 record" : `${filings.length} records`}</span>
                </li>
                <li className="flex gap-2">
                  <span className="text-neutral-500 dark:text-neutral-400">•</span>
                  <span>Open tasks: {openTaskCount}</span>
                </li>
              </ul>
              <p
                className={`mt-4 text-sm font-medium ${
                  readyToEscalate ? "text-emerald-800 dark:text-emerald-200" : "text-amber-900 dark:text-amber-200"
                }`}
              >
                {readyToEscalate ? "Ready to escalate" : "Needs more info"}
              </p>
            </>
          )}
        </section>

        <section className="mt-6" aria-labelledby="case-timeline-heading">
          <h2
            id="case-timeline-heading"
            className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
          >
            Case timeline
          </h2>
          {timeline.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">No activity recorded yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {timeline.map((row) => (
                <li
                  key={row.id}
                  className="rounded-xl border border-neutral-200/90 bg-white px-4 py-3 shadow-sm ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:ring-white/[0.06]"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">{row.label}</p>
                    <time className="shrink-0 text-xs text-neutral-500 dark:text-neutral-400" dateTime={row.ts}>
                      {formatTimelineTs(row.ts)}
                    </time>
                  </div>
                  {row.detail ? (
                    <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{row.detail}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <JusticeCaseTasks
          onCaseTimelineSynced={() => {
            const cid =
              caseId || (typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID) : null) || "";
            if (cid) setTimeline(readTimeline(cid));
          }}
          onTasksChange={() => setReadinessTick((n) => n + 1)}
        />

        <ul className="mt-8 space-y-5">
          <li
            className={merchantBadge ? mainDestinationLiRecommendedCls : mainDestinationLiNeutralCls}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                {merchantBadge && (
                  <p className="text-xs font-semibold uppercase text-blue-600 dark:text-blue-400">Recommended next</p>
                )}
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{merchantTitle}</h2>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  {merchantDescription}
                </p>
              </div>
            </div>
            {finalFollowUpPreviewVisible ? (
              <div className="mt-4 rounded-xl border border-neutral-200/90 bg-neutral-50/90 px-3 py-3 text-left shadow-inner ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-800/40 dark:ring-white/[0.04]">
                <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                  Final follow-up before escalation
                </p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  This is separate from your first contact message. Surrenderless does not send email or chat messages
                  for you — copy any text into your own email, chat, or support form.
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
                    Show saved contact summary and copyable nudge
                  </summary>
                  <ul className="mt-2 space-y-1.5 text-xs text-neutral-700 dark:text-neutral-300">
                    <li>
                      <span className="font-medium text-neutral-600 dark:text-neutral-400">Contact method: </span>
                      {planFinalFollowUpContactMethodLabel(intake.contact_method)}
                    </li>
                    <li>
                      <span className="font-medium text-neutral-600 dark:text-neutral-400">Contact date: </span>
                      {intake.contact_date?.trim() || "—"}
                    </li>
                    <li>
                      <span className="font-medium text-neutral-600 dark:text-neutral-400">Outcome recorded: </span>
                      {planFinalFollowUpOutcomeLabel(intake.merchant_response_type)}
                    </li>
                    {intake.contact_proof_text?.trim() ? (
                      <li>
                        <span className="font-medium text-neutral-600 dark:text-neutral-400">Proof / notes: </span>
                        {intake.contact_proof_text.trim().length > FINAL_FOLLOWUP_CONTACT_PROOF_PREVIEW_MAX
                          ? `${intake.contact_proof_text.trim().slice(0, FINAL_FOLLOWUP_CONTACT_PROOF_PREVIEW_MAX)}…`
                          : intake.contact_proof_text.trim()}
                      </li>
                    ) : null}
                  </ul>
                  <p className="mt-3 text-xs font-medium text-neutral-600 dark:text-neutral-400">
                    Copyable final follow-up (paste yourself)
                  </p>
                  <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-neutral-200/80 bg-white px-2 py-2 dark:border-neutral-600 dark:bg-neutral-900">
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-neutral-800 dark:text-neutral-200">
                      {buildFinalFollowUpNudgeText(intake)}
                    </pre>
                  </div>
                </details>
                <Link
                  href="/justice/merchant"
                  className="mt-3 inline-flex text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
                  onClick={() =>
                    void logEvent("merchant_resolution_started", {
                      case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                      from: "plan_final_follow_up_preview",
                    })
                  }
                >
                  Open full contact page to edit and save →
                </Link>
              </div>
            ) : null}
            {merchantBadge && merchantSuggestedMessageFull ? (
              <div className="mt-4 rounded-xl border border-neutral-200/90 bg-neutral-50/90 px-3 py-3 text-left shadow-inner ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-800/40 dark:ring-white/[0.04]">
                <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                  Suggested message (from your saved answers)
                </p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Nothing is sent from Surrenderless — use your own email, chat, or phone. Preview stays short to reduce
                  accidental sharing of personal details.
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
                    Show message preview
                  </summary>
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-neutral-200/80 bg-white px-2 py-2 dark:border-neutral-600 dark:bg-neutral-900">
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-neutral-800 dark:text-neutral-200">
                      {merchantSuggestedMessageFull.length > MERCHANT_MESSAGE_PLAN_PREVIEW_MAX
                        ? `${merchantSuggestedMessageFull.slice(0, MERCHANT_MESSAGE_PLAN_PREVIEW_MAX)}…`
                        : merchantSuggestedMessageFull}
                    </pre>
                  </div>
                  {merchantSuggestedMessageFull.length > MERCHANT_MESSAGE_PLAN_PREVIEW_MAX ? (
                    <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                      Preview is truncated here. Open the full page for the complete message, copy button, and saving
                      your contact record.
                    </p>
                  ) : null}
                </details>
                <Link
                  href="/justice/merchant"
                  className="mt-3 inline-flex text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  Open full page to copy and save →
                </Link>
              </div>
            ) : null}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row">
              <Link
                href="/justice/merchant"
                className="inline-flex justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-center text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg"
                onClick={() =>
                  void logEvent("merchant_resolution_started", {
                    case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                  })
                }
              >
                {merchantResolved ? "Update contact record" : "Start"}
              </Link>
              {!merchantResolved && (
                <Link
                  href="/justice/merchant"
                  className="inline-flex justify-center rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-center text-sm font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-200 dark:hover:bg-neutral-800"
                  onClick={() =>
                    void logEvent("merchant_resolution_started", {
                      case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                      from: "plan_ready_to_escalate_cta",
                    })
                  }
                >
                  {useCompanyContactLabels
                    ? "Company did not fix this / I’m ready to escalate"
                    : "Merchant did not fix this / I’m ready to escalate"}
                </Link>
              )}
            </div>
          </li>

          <li
            className={paymentRecommendedNext ? mainDestinationLiRecommendedCls : mainDestinationLiNeutralCls}
          >
            {paymentRecommendedNext && (
              <p className="text-xs font-semibold uppercase text-blue-600 dark:text-blue-400">Recommended next</p>
            )}
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Payment dispute</h2>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              Best when money was charged and you have transaction details.
            </p>
            {paymentOk && paymentDisputePreviewLetterFull ? (
              <div className="mt-4 rounded-xl border border-neutral-200/90 bg-neutral-50/90 px-3 py-3 text-left shadow-inner ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-800/40 dark:ring-white/[0.04]">
                <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                  Suggested bank/card dispute letter
                </p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Nothing is sent from Surrenderless — use your bank or card issuer&apos;s own app or website. Preview
                  uses the same template as the checklist with default dispute choices; open the full page to adjust
                  details, copy, and save. Preview stays short to reduce accidental sharing of personal details.
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
                    Show letter preview
                  </summary>
                  <div className="mt-2 max-h-40 overflow-y-auto rounded-lg border border-neutral-200/80 bg-white px-2 py-2 dark:border-neutral-600 dark:bg-neutral-900">
                    <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed text-neutral-800 dark:text-neutral-200">
                      {paymentDisputePreviewLetterFull.length > PAYMENT_DISPUTE_LETTER_PLAN_PREVIEW_MAX
                        ? `${paymentDisputePreviewLetterFull.slice(0, PAYMENT_DISPUTE_LETTER_PLAN_PREVIEW_MAX)}…`
                        : paymentDisputePreviewLetterFull}
                    </pre>
                  </div>
                  {paymentDisputePreviewLetterFull.length > PAYMENT_DISPUTE_LETTER_PLAN_PREVIEW_MAX ? (
                    <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
                      Preview is truncated here. Open the full checklist for the complete letter, copy button, and
                      saving your checklist to the case.
                    </p>
                  ) : null}
                </details>
                <Link
                  href="/justice/payment-dispute"
                  className="mt-3 inline-flex text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  Open full checklist to copy and save →
                </Link>
              </div>
            ) : null}
            {paymentOk ? (
              <Link
                href="/justice/payment-dispute"
                className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg"
                onClick={() =>
                  void logEvent("payment_dispute_started", {
                    case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                  })
                }
              >
                Start checklist
              </Link>
            ) : (
              <p className="mt-4 rounded-xl border border-neutral-200/80 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 shadow-inner dark:border-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
                Not available yet. Add payment/date details first.
              </p>
            )}
          </li>

          <li className="rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] transition-shadow duration-200 hover:shadow-xl hover:shadow-neutral-900/[0.07] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] dark:hover:shadow-black/50">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Evidence / proof</h2>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              Keep short notes on screenshots, receipts, emails, and other proof tied to this case.
            </p>
            {isSignedIn && evidenceRowsForPlan.length > 0 ? (
              <div className="mt-4 rounded-xl border border-neutral-200/90 bg-neutral-50/90 px-3 py-3 text-left shadow-inner ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-800/40 dark:ring-white/[0.04]">
                <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">Saved evidence</p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Metadata only — descriptions are shortened here. Open the evidence page to add or edit records.
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
                    Show saved evidence ({evidenceRowsForPlan.length})
                  </summary>
                  <ul className="mt-2 max-h-48 space-y-3 overflow-y-auto rounded-lg border border-neutral-200/80 bg-white px-3 py-3 dark:border-neutral-600 dark:bg-neutral-900">
                    {evidenceRowsForPlan.map((row) => {
                      const descPreview = truncatePlanEvidenceDescription(
                        row.description,
                        PLAN_EVIDENCE_PREVIEW_DESC_MAX
                      );
                      return (
                        <li
                          key={row.id}
                          className="border-t border-neutral-100 pt-3 first:border-t-0 first:pt-0 dark:border-neutral-700/80"
                        >
                          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">{row.title}</p>
                          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
                            {planEvidenceTypeLabel(row.evidence_type)}
                          </p>
                          {row.evidence_date ? (
                            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{row.evidence_date}</p>
                          ) : null}
                          {descPreview ? (
                            <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-700 dark:text-neutral-300">
                              {descPreview}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </details>
                <Link
                  href="/justice/evidence"
                  className="mt-3 inline-flex text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  Manage evidence →
                </Link>
              </div>
            ) : null}
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Link
                href="/justice/evidence"
                className="inline-flex justify-center rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
              >
                Add evidence
              </Link>
            </div>
          </li>

          <li className="rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] transition-shadow duration-200 hover:shadow-xl hover:shadow-neutral-900/[0.07] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] dark:hover:shadow-black/50">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Filing records</h2>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              Manual filing details saved for this case (prep pages or packet).
            </p>
            {readinessLoading ? (
              <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">Loading…</p>
            ) : filings.length === 0 ? (
              <p className="mt-3 text-sm text-neutral-600 dark:text-neutral-400">No filing records yet.</p>
            ) : (
              <dl className="mt-3 space-y-2.5 text-sm">
                <div>
                  <dt className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Records</dt>
                  <dd className="mt-0.5 text-neutral-800 dark:text-neutral-200">
                    {filings.length === 1 ? "1 filing record" : `${filings.length} filing records`}
                  </dd>
                </div>
                {planLatestFiling != null ? (
                  <>
                    <div>
                      <dt className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
                        Latest destination
                      </dt>
                      <dd className="mt-0.5 text-neutral-800 dark:text-neutral-200">{planLatestFiling.destination}</dd>
                    </div>
                    {planLatestFilingDateText ? (
                      <div>
                        <dt className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
                          Latest filing date
                        </dt>
                        <dd className="mt-0.5 text-neutral-800 dark:text-neutral-200">{planLatestFilingDateText}</dd>
                      </div>
                    ) : null}
                    {planLatestConfirmation ? (
                      <div>
                        <dt className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
                          Latest confirmation
                        </dt>
                        <dd className="mt-0.5 font-mono text-xs text-neutral-800 dark:text-neutral-200">
                          {planLatestConfirmation}
                        </dd>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </dl>
            )}
            {isSignedIn && filings.length > 0 ? (
              <div className="mt-4 rounded-xl border border-neutral-200/90 bg-neutral-50/90 px-3 py-3 text-left shadow-inner ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-800/40 dark:ring-white/[0.04]">
                <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">Saved filings</p>
                <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                  Preview only (no filing URLs here). Add or edit full records on the packet page.
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
                    Show saved filings ({filings.length})
                  </summary>
                  <ul className="mt-2 max-h-48 space-y-3 overflow-y-auto rounded-lg border border-neutral-200/80 bg-white px-3 py-3 dark:border-neutral-600 dark:bg-neutral-900">
                    {filings.map((row) => {
                      const confirmSnip = truncatePlanFilingSnippet(
                        row.confirmation_number,
                        PLAN_FILING_CONFIRM_PREVIEW_MAX
                      );
                      const notesSnip = truncatePlanFilingSnippet(row.notes, PLAN_FILING_NOTES_PREVIEW_MAX);
                      return (
                        <li
                          key={row.id}
                          className="border-t border-neutral-100 pt-3 first:border-t-0 first:pt-0 dark:border-neutral-700/80"
                        >
                          <p className="text-sm font-medium text-neutral-900 dark:text-neutral-100">
                            {row.destination}
                          </p>
                          {row.filed_at?.trim() ? (
                            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
                              Filed: {planFilingFiledAtLine(row.filed_at)}
                            </p>
                          ) : null}
                          {confirmSnip ? (
                            <p className="mt-1 font-mono text-xs text-neutral-700 dark:text-neutral-300">
                              Confirmation: {confirmSnip}
                            </p>
                          ) : null}
                          {notesSnip ? (
                            <p className="mt-1 whitespace-pre-wrap text-xs text-neutral-700 dark:text-neutral-300">
                              Notes: {notesSnip}
                            </p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </details>
                <Link
                  href="/justice/packet"
                  className="mt-3 inline-flex text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
                >
                  Open packet to add or edit filing records →
                </Link>
              </div>
            ) : null}
            <Link
              href="/justice/packet"
              className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg"
            >
              Open packet
            </Link>
          </li>

          <li className="rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] transition-shadow duration-200 hover:shadow-xl hover:shadow-neutral-900/[0.07] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] dark:hover:shadow-black/50">
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Case packet</h2>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              Copy one complete summary with timeline and evidence.
            </p>
            <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              <Link
                href="/justice/packet"
                className="inline-flex justify-center rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg"
              >
                Open packet
              </Link>
              <Link
                href="/justice/preview"
                className="inline-flex justify-center rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
              >
                Review submission draft
              </Link>
            </div>
          </li>

          <li
            className={step3RecommendedCardHighlight ? mainDestinationLiRecommendedCls : mainDestinationLiNeutralCls}
          >
            {merchantResolved ? (
              <>
                <p className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-400">Case resolved</p>
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Escalation not needed</h2>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  You marked this case as resolved with the merchant. FTC escalation is not recommended on this plan.
                </p>
              </>
            ) : cfpbRel ? (
              <>
                {contacted && cfpbPrepOpen ? (
                  <p className="text-xs font-semibold uppercase text-blue-600 dark:text-blue-400">Recommended next</p>
                ) : null}
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  Step 3 — Escalate to CFPB
                </h2>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  Use this for bank, credit, loan, payment, debt, billing, or financial account issues.
                </p>
                {cfpbPrepOpen ? (
                  <Link
                    href="/justice/cfpb"
                    className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg"
                    onClick={() =>
                      void logEvent("cfpb_prep_opened", {
                        case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                        from: "plan_step3",
                      })
                    }
                  >
                    Prepare CFPB complaint
                  </Link>
                ) : (
                  <p className="mt-4 rounded-xl border border-neutral-200/80 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 shadow-inner dark:border-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
                    {step3ContactLockMessage}
                  </p>
                )}
              </>
            ) : fccRel ? (
              <>
                {contacted && ftcOpen ? (
                  <p className="text-xs font-semibold uppercase text-blue-600 dark:text-blue-400">Recommended next</p>
                ) : null}
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  Step 3 — Escalate to FCC
                </h2>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  Use this for telecom, phone, internet, cable, broadcast, or unwanted-call or text issues.
                </p>
                {ftcOpen ? (
                  <Link
                    href="/justice/fcc"
                    className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg"
                    onClick={() =>
                      void logEvent("fcc_prep_opened", {
                        case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                        from: "plan_step3",
                      })
                    }
                  >
                    Prepare FCC complaint
                  </Link>
                ) : (
                  <p className="mt-4 rounded-xl border border-neutral-200/80 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 shadow-inner dark:border-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
                    {step3ContactLockMessage}
                  </p>
                )}
              </>
            ) : dotRel ? (
              <>
                {contacted && ftcOpen ? (
                  <p className="text-xs font-semibold uppercase text-blue-600 dark:text-blue-400">Recommended next</p>
                ) : null}
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  Step 3 — Escalate to DOT
                </h2>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  Use this for flight, airline, refund, cancellation, baggage, delays, or other aviation consumer issues.
                  Manual prep only — Surrenderless helps you draft text to copy; it does not file with DOT or any agency
                  automatically.
                </p>
                {ftcOpen ? (
                  <Link
                    href="/justice/dot"
                    className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg"
                    onClick={() =>
                      void logEvent("dot_prep_opened", {
                        case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                        from: "plan_step3",
                      })
                    }
                  >
                    Prepare DOT aviation complaint
                  </Link>
                ) : (
                  <p className="mt-4 rounded-xl border border-neutral-200/80 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 shadow-inner dark:border-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
                    {step3ContactLockMessage}
                  </p>
                )}
              </>
            ) : (
              <>
                {ftcPracticeDoneVisible && (
                  <p className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-400">
                    Practice completed
                  </p>
                )}
                {!merchantResolved && !ftcPracticeDoneVisible && contacted && ftcOpen && (
                  <p className="text-xs font-semibold uppercase text-blue-600 dark:text-blue-400">Recommended next</p>
                )}
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  {ftcPracticeDoneVisible ? "FTC practice completed" : "Step 3 — Escalate to FTC"}
                </h2>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  {ftcPracticeDoneVisible
                    ? "Your internal practice FTC form was filled. This was not a real government submission."
                    : "Use this after merchant contact failed or the company refused to help."}
                </p>
                {ftcOpen && !ftcPracticeDoneVisible ? (
                  <div className="mt-4 rounded-xl border border-neutral-200/90 bg-neutral-50/90 px-3 py-3 text-left shadow-inner ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-800/40 dark:ring-white/[0.04]">
                    <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">FTC practice preview</p>
                    <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                      Practice only — this is not a real FTC filing, nothing is submitted to the government automatically,
                      and Surrenderless does not file for you. Open the next page to use the internal practice form.
                    </p>
                    <details className="mt-2">
                      <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
                        Show practice fields preview
                      </summary>
                      <ul className="mt-2 space-y-1.5 text-xs text-neutral-700 dark:text-neutral-300">
                        <li>
                          <span className="font-medium text-neutral-600 dark:text-neutral-400">Company: </span>
                          {intake.company_name.trim() || "—"}
                        </li>
                        <li>
                          <span className="font-medium text-neutral-600 dark:text-neutral-400">Issue: </span>
                          {intake.problem_category.replace(/_/g, " ")}
                        </li>
                        {intake.money_involved.trim() ? (
                          <li>
                            <span className="font-medium text-neutral-600 dark:text-neutral-400">Money: </span>
                            {intake.money_involved.trim()}
                          </li>
                        ) : null}
                        {intake.pay_or_order_date.trim() ? (
                          <li>
                            <span className="font-medium text-neutral-600 dark:text-neutral-400">Date / order: </span>
                            {intake.pay_or_order_date.trim()}
                          </li>
                        ) : null}
                        {intake.reply_email.trim() ? (
                          <li>
                            <span className="font-medium text-neutral-600 dark:text-neutral-400">Reply email: </span>
                            {intake.reply_email.trim()}
                          </li>
                        ) : null}
                      </ul>
                      {intake.story.trim() ? (
                        <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-neutral-200/80 bg-white px-2 py-2 dark:border-neutral-600 dark:bg-neutral-900">
                          <p className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                            Complaint summary
                          </p>
                          <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-neutral-800 dark:text-neutral-200">
                            {intake.story.trim().length > FTC_STORY_PLAN_PREVIEW_MAX
                              ? `${intake.story.trim().slice(0, FTC_STORY_PLAN_PREVIEW_MAX)}…`
                              : intake.story.trim()}
                          </p>
                        </div>
                      ) : null}
                    </details>
                    <Link
                      href="/justice/ftc-review"
                      className="mt-3 inline-flex text-sm font-semibold text-blue-600 hover:underline dark:text-blue-400"
                      onClick={() =>
                        void logEvent("ftc_mock_review_opened", {
                          case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                          from: "plan_ftc_practice_preview",
                        })
                      }
                    >
                      Continue to practice FTC form →
                    </Link>
                  </div>
                ) : null}
                {ftcOpen ? (
                  <Link
                    href="/justice/ftc-review"
                    className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg"
                    onClick={() =>
                      void logEvent("ftc_mock_review_opened", {
                        case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                      })
                    }
                  >
                    {ftcPracticeDoneVisible ? "Review practice FTC form again" : "Review and run practice FTC form"}
                  </Link>
                ) : (
                  <p className="mt-4 rounded-xl border border-neutral-200/80 bg-neutral-50 px-4 py-3 text-sm text-neutral-700 shadow-inner dark:border-neutral-600 dark:bg-neutral-800/60 dark:text-neutral-300">
                    {step3ContactLockMessage}
                  </p>
                )}
              </>
            )}
          </li>
        </ul>

        <section className="mt-10" aria-labelledby="destinations-heading">
          <h2
            id="destinations-heading"
            className="text-lg font-semibold text-neutral-900 dark:text-neutral-100"
          >
            Other places this may go
          </h2>
          <ul className="mt-4 space-y-3">
            {destinations.map((d) => (
              <li
                key={d.id}
                className="rounded-2xl border border-neutral-200/90 bg-white p-4 shadow-md shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06]"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 w-full flex-1">
                    <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
                      {destinationStatusBadgeLabel(d.status)}
                    </p>
                    <p className="mt-1 font-medium text-neutral-900 dark:text-neutral-100">
                      {d.id === "merchant_resolution" && useCompanyContactLabels
                        ? "Company contact & proof"
                        : d.label}
                    </p>
                    {d.status === "locked" ? (
                      <p className="mt-2 text-sm leading-relaxed text-neutral-600 dark:text-neutral-400">
                        {d.rationale}
                      </p>
                    ) : (
                      <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">{d.rationale}</p>
                    )}
                    {d.internalRoute &&
                    (d.id === "bbb" ||
                      d.id === "state_ag" ||
                      d.id === "cfpb" ||
                      d.id === "fcc" ||
                      d.id === "dot" ||
                      d.id === "small_claims") ? (
                      <div className="mt-3 rounded-xl border border-neutral-200/90 bg-neutral-50/90 px-3 py-3 text-left shadow-inner ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-800/40 dark:ring-white/[0.04]">
                        <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
                          {d.id === "bbb"
                            ? "BBB"
                            : d.id === "state_ag"
                              ? "State AG"
                              : d.id === "cfpb"
                                ? "CFPB"
                                : d.id === "fcc"
                                  ? "FCC"
                                  : d.id === "dot"
                                    ? "USDOT / aviation"
                                    : "Demand letter"}{" "}
                          manual prep preview
                        </p>
                        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                          Manual prep only — Surrenderless does not file complaints or send them to regulators
                          automatically. Open the prep page for the full checklist and copy-ready draft text.
                        </p>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-sm font-medium text-blue-600 hover:underline dark:text-blue-400">
                            Show prep metadata
                          </summary>
                          <ul className="mt-2 space-y-1.5 text-xs text-neutral-700 dark:text-neutral-300">
                            <li>
                              <span className="font-medium text-neutral-600 dark:text-neutral-400">Company: </span>
                              {intake.company_name.trim() || "—"}
                            </li>
                            <li>
                              <span className="font-medium text-neutral-600 dark:text-neutral-400">Issue: </span>
                              {intake.problem_category.replace(/_/g, " ")}
                            </li>
                            {intake.money_involved.trim() ? (
                              <li>
                                <span className="font-medium text-neutral-600 dark:text-neutral-400">Money: </span>
                                {intake.money_involved.trim()}
                              </li>
                            ) : null}
                            {intake.pay_or_order_date.trim() ? (
                              <li>
                                <span className="font-medium text-neutral-600 dark:text-neutral-400">
                                  Date / order:{" "}
                                </span>
                                {intake.pay_or_order_date.trim()}
                              </li>
                            ) : null}
                            {d.id === "state_ag" ? (
                              <li>
                                <span className="font-medium text-neutral-600 dark:text-neutral-400">State (AG): </span>
                                {intake.consumer_us_state?.trim()
                                  ? intake.consumer_us_state.trim().toUpperCase()
                                  : "Not selected"}
                              </li>
                            ) : null}
                            <li>
                              <span className="font-medium text-neutral-600 dark:text-neutral-400">
                                Merchant contact:{" "}
                              </span>
                              {intake.already_contacted === "yes"
                                ? `Documented — outcome: ${planFinalFollowUpOutcomeLabel(intake.merchant_response_type)}`
                                : "Not saved as contacted yet"}
                            </li>
                          </ul>
                          {intake.story.trim() ? (
                            <div className="mt-2 max-h-32 overflow-y-auto rounded-lg border border-neutral-200/80 bg-white px-2 py-2 dark:border-neutral-600 dark:bg-neutral-900">
                              <p className="text-[11px] font-medium text-neutral-600 dark:text-neutral-400">
                                Complaint summary
                              </p>
                              <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-neutral-800 dark:text-neutral-200">
                                {intake.story.trim().length > BBB_STATE_AG_STORY_PLAN_PREVIEW_MAX
                                  ? `${intake.story.trim().slice(0, BBB_STATE_AG_STORY_PLAN_PREVIEW_MAX)}…`
                                  : intake.story.trim()}
                              </p>
                            </div>
                          ) : null}
                        </details>
                        <p className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
                          {d.id === "bbb"
                            ? "Copy full draft on BBB prep page."
                            : d.id === "state_ag"
                              ? "Copy full draft on State AG prep page."
                              : d.id === "cfpb"
                                ? "Copy full draft on CFPB prep page."
                                : d.id === "fcc"
                                  ? "Copy full draft on FCC prep page."
                                  : "Copy full draft on DOT aviation prep page."}
                        </p>
                      </div>
                    ) : null}
                  </div>
                  {d.internalRoute ? (
                    <div className="shrink-0 sm:pt-5">
                      <Link
                        href={d.internalRoute}
                        className="inline-flex rounded-xl bg-blue-600 px-3 py-2 text-sm font-semibold text-white shadow-md shadow-blue-900/20 hover:bg-blue-700"
                        onClick={() => {
                          if (d.id === "merchant_resolution") {
                            void logEvent("merchant_resolution_started", {
                              case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                              from: "destinations_engine",
                            });
                          }
                          if (d.id === "payment_dispute") {
                            void logEvent("payment_dispute_started", {
                              case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                              from: "destinations_engine",
                            });
                          }
                          if (d.id === "ftc") {
                            void logEvent("ftc_mock_review_opened", {
                              case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                              from: "destinations_engine",
                            });
                          }
                          if (d.id === "bbb") {
                            void logEvent("bbb_prep_opened", {
                              case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                              from: "destinations_engine",
                            });
                          }
                          if (d.id === "state_ag") {
                            void logEvent("state_ag_prep_opened", {
                              case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                              from: "destinations_engine",
                            });
                          }
                          if (d.id === "cfpb") {
                            void logEvent("cfpb_prep_opened", {
                              case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                              from: "destinations_engine",
                            });
                          }
                          if (d.id === "fcc") {
                            void logEvent("fcc_prep_opened", {
                              case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                              from: "destinations_engine",
                            });
                          }
                          if (d.id === "dot") {
                            void logEvent("dot_prep_opened", {
                              case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                              from: "destinations_engine",
                            });
                          }
                          if (d.id === "small_claims") {
                            void logEvent("demand_letter_prep_opened", {
                              case_id: caseId || sessionStorage.getItem(STORAGE_CASE_ID),
                              from: "destinations_engine",
                            });
                          }
                        }}
                      >
                        Open
                      </Link>
                    </div>
                  ) : d.status === "manual" ? (
                    <div className="shrink-0 sm:pt-5">
                      <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">
                        Manual for now
                      </span>
                    </div>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
