"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { validate as isUuid } from "uuid";
import Header from "@/app/components/Header";
import JusticeActionResumeSignInPrompt from "@/app/components/JusticeActionResumeSignInPrompt";
import JusticeCaseTasks from "@/app/components/JusticeCaseTasks";
import JusticeFilingRecords from "@/app/components/JusticeFilingRecords";
import {
  JUSTICE_EVIDENCE_TYPE_LABELS,
  type JusticeCaseEvidenceRow,
  type JusticeEvidenceType,
} from "@/lib/justice/evidence";
import { ApprovedNextActionFollowUpTimingLine } from "@/lib/justice/approvedNextActionFollowUp";
import { ApprovedNextActionHandlingRequestedReadOnly } from "@/lib/justice/approvedNextActionHandlingDisplay";
import {
  parseJusticeCaseClientState,
  resolveApprovedNextAction,
  writeSessionApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import {
  cfpbLikelyRelevant,
  computeJusticeDestinations,
  dotLikelyRelevant,
  fccLikelyRelevant,
  isMerchantResolved,
} from "@/lib/justice/rules";
import type {
  JusticeApprovedNextAction,
  JusticeCaseClientState,
  JusticeDestination,
  JusticeIntake,
  TimelineEntry,
  TimelineEntryType,
} from "@/lib/justice/types";
import { STORAGE_FTC_MANUAL_UNLOCK } from "@/lib/justice/types";
import { STORAGE_CASE_ID } from "@/lib/justice/types";
import { readTimeline } from "@/lib/justice/timeline";
import { useJusticeActionPageHydration } from "@/lib/justice/useJusticeActionPageHydration";

/** Mirrors post-review callout gates on `/justice/plan` (page-local; does not change rules). */
const PREP_OPENED_TYPES: TimelineEntryType[] = [
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

/** Post-review next step; mirrors `/justice/plan` `pickPreparedNextAction` (page-local). */
function pickPreparedNextAction(params: {
  contacted: boolean;
  useCompanyContactLabels: boolean;
  destinations: JusticeDestination[];
}): { detailHref: string | null; stepLabel: string } {
  const { contacted, useCompanyContactLabels, destinations } = params;

  if (!contacted) {
    return {
      detailHref: "/justice/merchant",
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
      detailHref: firstRoutableDest.internalRoute,
      stepLabel: firstRoutableDest.label,
    };
  }

  return {
    detailHref: null,
    stepLabel: "Prepared case review",
  };
}

function buildApprovedNextActionTarget(
  prepared: ReturnType<typeof pickPreparedNextAction>
): JusticeApprovedNextAction {
  return {
    label: prepared.stepLabel,
    href: prepared.detailHref ?? "/justice/packet",
    status: "approved",
    approved_at: new Date().toISOString(),
  };
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

function showPreparedActionPacketFraming(intake: JusticeIntake, timeline: TimelineEntry[]): boolean {
  if (isMerchantResolved(intake)) return false;
  if (!timeline.some((e) => e.type === "submission_draft_reviewed")) return false;
  const movedOn =
    timeline.some((e) => PREP_OPENED_TYPES.includes(e.type)) ||
    timeline.some((e) => FILED_COMPLAINT_TYPES.includes(e.type)) ||
    timeline.some((e) => e.type === "ftc_practice_completed");
  return !movedOn;
}

/** Page-local session flags per case (no API / timeline writes). */
const STORAGE_PREPARED_PACKET_APPROVED_V1 = "justice_prepared_packet_approved_v1";

function readPreparedPacketApproved(caseId: string): boolean {
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

function writePreparedPacketApproved(caseId: string): void {
  if (typeof window === "undefined" || !caseId) return;
  try {
    const raw = sessionStorage.getItem(STORAGE_PREPARED_PACKET_APPROVED_V1);
    const map: Record<string, boolean> = raw ? (JSON.parse(raw) as Record<string, boolean>) : {};
    map[caseId] = true;
    sessionStorage.setItem(STORAGE_PREPARED_PACKET_APPROVED_V1, JSON.stringify(map));
  } catch {
    // ignore corrupt session data
  }
}

function isPreparedPacketApprovedInClientState(raw: unknown): boolean {
  return parseJusticeCaseClientState(raw).prepared_packet_approved === true;
}

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";

/** Light background for dark-mode users; @page margin for exported print. */
const PRINT_STYLES = `
@media print {
  @page { margin: 0.6in; }
  html, body {
    background: #fff !important;
  }
}
`;

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

function desiredResolutionPhrase(category: JusticeIntake["problem_category"]): string {
  switch (category) {
    case "financial_account_issue":
      return "Correction of account errors, improper charges, or clear written explanation of the issue.";
    case "online_purchase":
      return "A full refund or a correct replacement, whichever fairly applies.";
    case "subscription":
      return "Cancellation of unwanted recurring charges and any refund owed for improper renewals.";
    case "service_failed":
      return "A remedy that matches what was promised (refund, redo, or credit).";
    case "charge_dispute":
      return "Reversal of the charge or a clear written justification.";
    case "something_else":
      return "A fair resolution that puts me back to where I should have been.";
    default:
      return "A fair resolution that puts me back to where I should have been.";
  }
}

function evidenceTypeLabel(t: string): string {
  return JUSTICE_EVIDENCE_TYPE_LABELS[t as JusticeEvidenceType] ?? t.replace(/_/g, " ");
}

function formatEvidenceAdded(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
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

function buildPacketPlainText(
  intake: JusticeIntake,
  timeline: TimelineEntry[],
  evidence: JusticeCaseEvidenceRow[],
  filings: JusticeCaseFilingRow[],
  caseId: string
): string {
  const lines: string[] = [
    "JUSTICE CASE PACKET",
    "====================",
    `Generated: ${new Date().toISOString()}`,
    `Case id: ${caseId}`,
    "",
    "CASE SUMMARY",
    "--------------",
    `Company: ${intake.company_name}`,
    `Website: ${intake.company_website.trim() || "—"}`,
    `Issue category: ${intake.problem_category.replace(/_/g, " ")}`,
    `Product / service: ${intake.purchase_or_signup.trim() || "—"}`,
    `Money involved: ${intake.money_involved}`,
    `Order or problem date: ${intake.pay_or_order_date}`,
    intake.order_confirmation_details.trim()
      ? `Order / confirmation details: ${intake.order_confirmation_details.trim()}`
      : "",
    `Consumer name: ${intake.user_display_name}`,
    `Reply email: ${intake.reply_email}`,
    intake.consumer_us_state?.trim()
      ? `Consumer state (if noted): ${intake.consumer_us_state.trim().toUpperCase()}`
      : "",
    `Already contacted company: ${intake.already_contacted}`,
    intake.already_contacted === "yes" && intake.contact_method
      ? `Contact method: ${intake.contact_method.replace(/_/g, " ")}`
      : "",
    intake.contact_date ? `Contact date: ${intake.contact_date}` : "",
    intake.merchant_response_type
      ? `Their response (as recorded): ${intake.merchant_response_type.replace(/_/g, " ")}`
      : "",
    "",
    "WHAT HAPPENED",
    "---------------",
    intake.story.trim(),
    "",
    "REQUESTED RESOLUTION",
    "--------------------",
    desiredResolutionPhrase(intake.problem_category),
    "",
    "TIMELINE",
    "--------",
  ];

  const sorted = [...timeline].sort((a, b) => a.ts.localeCompare(b.ts));
  if (sorted.length === 0) {
    lines.push("(No timeline events yet.)");
  } else {
    for (const row of sorted) {
      const when = formatTimelineTs(row.ts);
      const detail = row.detail?.trim();
      lines.push(`- ${when} — ${row.label}${detail ? ` — ${detail}` : ""}`);
    }
  }

  lines.push("", "SAVED EVIDENCE (notes)", "----------------------");
  if (evidence.length === 0) {
    lines.push("(No saved evidence records yet.)");
  } else {
    evidence.forEach((row, i) => {
      lines.push(
        `${i + 1}. ${row.title}`,
        `   Type: ${evidenceTypeLabel(row.evidence_type)}`,
        row.evidence_date ? `   Date: ${row.evidence_date}` : "",
        row.description?.trim() ? `   Description: ${row.description.trim()}` : "",
        row.source_url?.trim() ? `   Source URL: ${row.source_url.trim()}` : "",
        row.storage_note?.trim() ? `   Storage: ${row.storage_note.trim()}` : "",
        `   Recorded: ${formatEvidenceAdded(row.created_at)}`,
        ""
      );
    });
  }

  lines.push("", "FILING RECORDS", "---------------");
  if (filings.length === 0) {
    lines.push("(No filing records yet.)");
  } else {
    filings.forEach((row, i) => {
      lines.push(
        `${i + 1}. ${row.destination}`,
        row.filed_at ? `   Filed at: ${row.filed_at}` : "",
        row.confirmation_number ? `   Confirmation: ${row.confirmation_number}` : "",
        row.filing_url ? `   URL: ${row.filing_url}` : "",
        row.notes?.trim() ? `   Notes: ${row.notes.trim()}` : "",
        `   Recorded: ${formatEvidenceAdded(row.created_at)}`,
        ""
      );
    });
  }

  lines.push("---", "End of packet");
  return lines.filter(Boolean).join("\n").trim();
}

export default function JusticePacketPage() {
  const { isSignedIn, isLoaded } = useAuth();
  const { status: hydrationStatus, intake } = useJusticeActionPageHydration();
  const [caseId, setCaseId] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const [evidence, setEvidence] = useState<JusticeCaseEvidenceRow[]>([]);
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const [evidenceError, setEvidenceError] = useState(false);
  const [filings, setFilings] = useState<JusticeCaseFilingRow[]>([]);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [timelineTick, setTimelineTick] = useState(0);
  const [packetApproved, setPacketApproved] = useState(false);
  const [approvedNextAction, setApprovedNextAction] = useState<JusticeApprovedNextAction | undefined>(
    undefined
  );
  const [approveChecked, setApproveChecked] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setCaseId(sessionStorage.getItem(STORAGE_CASE_ID) ?? "");
    setSessionReady(true);
    const t0 = window.setTimeout(() => setCaseId(sessionStorage.getItem(STORAGE_CASE_ID) ?? ""), 0);
    const t1 = window.setTimeout(() => setCaseId(sessionStorage.getItem(STORAGE_CASE_ID) ?? ""), 200);
    return () => {
      window.clearTimeout(t0);
      window.clearTimeout(t1);
    };
  }, [hydrationStatus, intake]);

  const timeline = useMemo(() => {
    if (!caseId) return [];
    return readTimeline(caseId);
  }, [caseId, intake, hydrationStatus]);

  const loadEvidence = useCallback(async () => {
    const cid = typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID) ?? "" : "";
    if (!cid || !isLoaded || !isSignedIn) {
      setEvidence([]);
      return;
    }
    setEvidenceLoading(true);
    setEvidenceError(false);
    try {
      const res = await fetch(`/api/justice/evidence?case_id=${encodeURIComponent(cid)}`);
      if (!res.ok) {
        setEvidenceError(true);
        setEvidence([]);
        return;
      }
      const data = (await res.json()) as JusticeCaseEvidenceRow[];
      setEvidence(Array.isArray(data) ? data : []);
    } catch {
      setEvidenceError(true);
      setEvidence([]);
    } finally {
      setEvidenceLoading(false);
    }
  }, [isLoaded, isSignedIn]);

  const loadFilings = useCallback(async () => {
    const cid = typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID) ?? "" : "";
    if (!cid || !isLoaded || !isSignedIn) {
      setFilings([]);
      return;
    }
    try {
      const res = await fetch(`/api/justice/filings?case_id=${encodeURIComponent(cid)}`);
      if (!res.ok) {
        setFilings([]);
        return;
      }
      const data = (await res.json()) as JusticeCaseFilingRow[];
      setFilings(Array.isArray(data) ? data : []);
    } catch {
      setFilings([]);
    }
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (hydrationStatus !== "ready" || !intake || !isLoaded || !isSignedIn) return;
    const cid = sessionStorage.getItem(STORAGE_CASE_ID) ?? "";
    if (!cid) return;
    void Promise.all([loadEvidence(), loadFilings()]);
  }, [hydrationStatus, intake, isLoaded, isSignedIn, loadEvidence, loadFilings, caseId]);

  useEffect(() => {
    if (!caseId) {
      setPacketApproved(false);
      setApprovedNextAction(undefined);
      setApproveChecked(false);
      return;
    }
    const sessionApproved = readPreparedPacketApproved(caseId);
    const sessionNextAction = resolveApprovedNextAction(caseId, undefined);
    if (!isLoaded || !isSignedIn || !isUuid(caseId)) {
      setPacketApproved(sessionApproved);
      setApprovedNextAction(sessionNextAction);
      return;
    }

    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
          signal: ac.signal,
        });
        if (!res.ok) {
          if (!ac.signal.aborted) {
            setPacketApproved(sessionApproved);
            setApprovedNextAction(sessionNextAction);
          }
          return;
        }
        const data = (await res.json()) as { client_state?: unknown };
        if (ac.signal.aborted) return;
        const parsed = parseJusticeCaseClientState(data.client_state);
        const serverApproved = parsed.prepared_packet_approved === true;
        if (serverApproved) writePreparedPacketApproved(caseId);
        const resolved = resolveApprovedNextAction(caseId, data.client_state) ?? sessionNextAction;
        if (resolved) writeSessionApprovedNextAction(caseId, resolved);
        setPacketApproved(sessionApproved || serverApproved);
        setApprovedNextAction(resolved);
      } catch {
        if (!ac.signal.aborted) {
          setPacketApproved(sessionApproved);
          setApprovedNextAction(sessionNextAction);
        }
      }
    })();

    return () => ac.abort();
  }, [caseId, hydrationStatus, isLoaded, isSignedIn]);

  const packetText = useMemo(() => {
    if (!intake || !caseId) return "";
    return buildPacketPlainText(intake, timeline, evidence, filings, caseId);
  }, [intake, timeline, evidence, filings, caseId]);

  async function copyPacket() {
    if (!packetText) return;
    try {
      await navigator.clipboard.writeText(packetText);
      setCopyHint("Copied to clipboard.");
      window.setTimeout(() => setCopyHint(null), 2500);
    } catch {
      setCopyHint("Copy failed — select the text and copy manually.");
    }
  }

  function downloadPacket() {
    if (!packetText || !caseId) return;
    const blob = new Blob([packetText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `justice-case-packet-${caseId}.txt`;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  function printPacket() {
    window.print();
  }

  if (hydrationStatus === "needs_sign_in") {
    return <JusticeActionResumeSignInPrompt />;
  }

  if (!sessionReady || hydrationStatus === "loading" || hydrationStatus === "redirecting") {
    return (
      <>
        <Header />
        <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-neutral-50 to-neutral-100/80 p-6 text-neutral-500 dark:from-neutral-950 dark:to-neutral-900 dark:text-neutral-400">
          Loading…
        </main>
      </>
    );
  }

  if (hydrationStatus !== "ready" || !intake) {
    return (
      <>
        <Header />
        <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-neutral-50 to-neutral-100/80 p-6 text-neutral-500 dark:from-neutral-950 dark:to-neutral-900 dark:text-neutral-400">
          Loading…
        </main>
      </>
    );
  }

  if (!isLoaded || !isSignedIn) {
    return (
      <>
        <Header />
        <main className="mx-auto max-w-lg px-4 py-8">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">Sign in to view your case packet.</p>
          <Link href="/justice/cases" className="mt-3 inline-block text-sm font-medium text-blue-600 hover:underline">
            Saved cases
          </Link>
        </main>
      </>
    );
  }

  if (!caseId) {
    return (
      <>
        <Header />
        <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            <Link href="/justice/plan" className="text-blue-600 hover:underline dark:text-blue-400">
              Back to action plan
            </Link>
            {" · "}
            <Link href="/justice/evidence" className="text-blue-600 hover:underline dark:text-blue-400">
              Evidence
            </Link>
            {" · "}
            <Link href="/justice/cases" className="text-blue-600 hover:underline dark:text-blue-400">
              Saved cases
            </Link>
          </p>
          <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Case packet</h1>
          <div className={`mt-6 ${cardCls}`}>
            <p className="text-sm text-neutral-700 dark:text-neutral-300">
              No active case id in this browser. Open a saved case from your list, then return here.
            </p>
            <Link
              href="/justice/cases"
              className="mt-4 inline-flex rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md hover:bg-blue-700"
            >
              Saved cases
            </Link>
          </div>
        </main>
      </>
    );
  }

  const resolution = desiredResolutionPhrase(intake.problem_category);
  const showPreparedActionFraming = showPreparedActionPacketFraming(intake, timeline);
  const approvedNextActionCompleted = approvedNextAction?.status === "completed";
  const approvedNextActionStarted = approvedNextAction?.status === "started";

  async function handleApprovePreparedPacket() {
    if (!caseId || !approveChecked || !intake) return;

    const manualFtc =
      typeof window !== "undefined" && sessionStorage.getItem(STORAGE_FTC_MANUAL_UNLOCK) === "1";
    const contacted = intake.already_contacted === "yes";
    const cfpbRel = cfpbLikelyRelevant(intake);
    const fccRel = fccLikelyRelevant(intake);
    const dotRel = dotLikelyRelevant(intake);
    const useCompanyContactLabels = cfpbRel || fccRel || dotRel;
    const destinations = computeJusticeDestinations(intake, { manualFtc, useCompanyContactLabels });
    const prepared = pickPreparedNextAction({ contacted, useCompanyContactLabels, destinations });
    const nextActionTarget = buildApprovedNextActionTarget(prepared);

    writePreparedPacketApproved(caseId);
    writeSessionApprovedNextAction(caseId, nextActionTarget);
    setPacketApproved(true);
    setApprovedNextAction(nextActionTarget);

    if (!isLoaded || !isSignedIn || !isUuid(caseId)) return;

    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice packet: GET /api/justice/cases/[id] (client_state) failed", getRes.status);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged: JusticeCaseClientState = {
        ...parseJusticeCaseClientState(existing.client_state),
        prepared_packet_approved: true,
        approved_next_action: nextActionTarget,
      };
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        console.warn("justice packet: PATCH /api/justice/cases/[id] (client_state) failed", patchRes.status);
      }
    } catch (e) {
      console.warn("justice packet: PATCH /api/justice/cases/[id] (client_state) error", e);
    }
  }

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: PRINT_STYLES }} />
      <div className="print:hidden">
        <Header />
        <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-2xl bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            <Link href="/justice/plan" className="text-blue-600 hover:underline dark:text-blue-400">
              Back to action plan
            </Link>
            {" · "}
            <Link href="/justice/evidence" className="text-blue-600 hover:underline dark:text-blue-400">
              Evidence
            </Link>
            {" · "}
            <Link href="/justice/cases" className="text-blue-600 hover:underline dark:text-blue-400">
              Saved cases
            </Link>
          </p>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Case packet</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {showPreparedActionFraming
            ? "Prepared in-app review of your case: summary, timeline, evidence notes, and filing records in one place."
            : "One copy-ready bundle: summary, resolution, timeline, evidence notes, and filing records."}
        </p>
        <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">Case id: {caseId}</p>

        {showPreparedActionFraming ? (
          <>
          <div
            className="mt-4 rounded-xl border border-emerald-200/90 bg-emerald-50/80 px-4 py-4 text-sm shadow-sm ring-1 ring-emerald-950/[0.05] dark:border-emerald-800/70 dark:bg-emerald-950/30 dark:ring-emerald-400/10"
            role="status"
            aria-label="Prepared action review packet"
          >
            <p className="font-semibold text-emerald-950 dark:text-emerald-100">Your prepared action review</p>
            <p className="mt-2 leading-relaxed text-emerald-900/95 dark:text-emerald-100/95">
              Surrenderless assembled this packet from your reviewed submission draft so you can confirm your case
              details, proof, and records before your next step. This is in-app preparation and review — nothing has
              been filed automatically, and Surrenderless has not submitted, filed, or contacted anyone on your behalf.
            </p>
            <p className="mt-2 text-xs leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
              When you complete an external filing yourself, record confirmations in the filing section below.
              Surrenderless does not submit or queue government complaints for you yet.
            </p>
            <Link
              href="/justice/plan"
              className="mt-3 inline-flex text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
            >
              Back to action plan
            </Link>
          </div>
          {approvedNextAction?.handling_requested_at?.trim() ? (
            <ApprovedNextActionHandlingRequestedReadOnly
              requestedAt={approvedNextAction.handling_requested_at.trim()}
              requestNote={approvedNextAction.handling_request_note}
              acknowledgedAt={approvedNextAction.handling_acknowledged_at}
            />
          ) : null}
          {packetApproved ? (
              <div
                className="mt-3 rounded-xl border border-emerald-300/80 bg-emerald-50/90 px-4 py-3 text-sm ring-1 ring-emerald-600/15 dark:border-emerald-700/80 dark:bg-emerald-950/40 dark:ring-emerald-400/15"
                role="status"
              >
                <p className="font-semibold text-emerald-950 dark:text-emerald-100">
                  {approvedNextActionCompleted
                    ? "Next action recorded as handled"
                    : approvedNextActionStarted
                      ? "Next action started"
                      : "Packet approved for next action"}
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
                      . Surrenderless has not filed, submitted, sent, or contacted anyone on your behalf. Record handled
                      status from your action plan when ready.
                    </>
                  ) : (
                    <>
                      You reviewed this prepared packet
                      {approvedNextAction?.label ? (
                        <>
                          {" "}
                          for <strong>{approvedNextAction.label}</strong>
                        </>
                      ) : null}
                      . Surrenderless has not filed, submitted, sent, or contacted anyone on your behalf. Continue from
                      your action plan when you are ready for the next in-app step.
                    </>
                  )}
                </p>
                {approvedNextActionStarted ? (
                  <p className="mt-1.5 text-xs font-medium text-emerald-800 dark:text-emerald-200">
                    Opened for next step.
                  </p>
                ) : null}
                {approvedNextActionCompleted && approvedNextAction ? (
                  <ApprovedNextActionTrackingSummary action={approvedNextAction} />
                ) : null}
                {!approvedNextActionStarted &&
                !approvedNextActionCompleted &&
                approvedNextAction?.href &&
                approvedNextAction.label ? (
                  <Link
                    href={approvedNextAction.href}
                    className="mt-2 inline-flex text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                  >
                    Open {approvedNextAction.label}
                  </Link>
                ) : null}
                <Link
                  href="/justice/plan"
                  className={`${approvedNextAction?.href ? "mt-2 ml-4" : "mt-2"} inline-flex text-sm font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100`}
                >
                  Continue from action plan
                </Link>
              </div>
            ) : (
              <div
                className={`mt-3 ${cardCls}`}
                aria-labelledby="packet-approve-heading"
              >
                <h2
                  id="packet-approve-heading"
                  className="text-base font-semibold text-neutral-900 dark:text-neutral-100"
                >
                  Approve for next action
                </h2>
                <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
                  Review the case summary, timeline, evidence, and filing records below. When this packet looks right,
                  approve it so Surrenderless can treat it as ready for your next in-app step — nothing is filed or sent
                  automatically.
                </p>
                <label className="mt-4 flex cursor-pointer items-start gap-3 text-sm text-neutral-800 dark:text-neutral-200">
                  <input
                    type="checkbox"
                    className="mt-0.5 h-4 w-4 rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                    checked={approveChecked}
                    onChange={(e) => setApproveChecked(e.target.checked)}
                  />
                  <span>I reviewed this prepared packet</span>
                </label>
                <button
                  type="button"
                  disabled={!approveChecked}
                  onClick={() => void handleApprovePreparedPacket()}
                  className="mt-4 w-full rounded-xl bg-emerald-700 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-emerald-900/20 transition hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-emerald-600 dark:hover:bg-emerald-500"
                >
                  Approve prepared packet for next action
                </button>
              </div>
            )}
          </>
        ) : null}

        <section className={`mt-6 ${cardCls}`} aria-labelledby="packet-summary">
          <h2 id="packet-summary" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Case summary
          </h2>
          <ul className="mt-3 space-y-2 text-sm text-neutral-800 dark:text-neutral-200">
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Company:</span> {intake.company_name}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Website:</span>{" "}
              {intake.company_website.trim() || "—"}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Issue:</span>{" "}
              {intake.problem_category.replace(/_/g, " ")}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Product / service:</span>{" "}
              {intake.purchase_or_signup.trim() || "—"}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Money:</span> {intake.money_involved}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Date:</span> {intake.pay_or_order_date}
            </li>
          </ul>
        </section>

        <section className={`mt-5 ${cardCls}`} aria-labelledby="packet-resolution">
          <h2 id="packet-resolution" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Requested resolution
          </h2>
          <p className="mt-2 text-sm text-neutral-800 dark:text-neutral-200">{resolution}</p>
        </section>

        <section className={`mt-5 ${cardCls}`} aria-labelledby="packet-timeline">
          <h2 id="packet-timeline" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Timeline
          </h2>
          {timeline.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">No timeline events yet.</p>
          ) : (
            <ul className="mt-3 space-y-3">
              {[...timeline]
                .sort((a, b) => a.ts.localeCompare(b.ts))
                .map((row) => (
                  <li key={row.id} className="text-sm text-neutral-800 dark:text-neutral-200">
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">{formatTimelineTs(row.ts)}</span>
                    <p className="font-medium text-neutral-900 dark:text-neutral-100">{row.label}</p>
                    {row.detail ? (
                      <p className="mt-0.5 text-xs text-neutral-600 dark:text-neutral-400">{row.detail}</p>
                    ) : null}
                  </li>
                ))}
            </ul>
          )}
        </section>

        <section className={`mt-5 ${cardCls}`} aria-labelledby="packet-evidence">
          <h2 id="packet-evidence" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Saved evidence
          </h2>
          {evidenceLoading ? (
            <p className="mt-2 text-sm text-neutral-500 dark:text-neutral-400">Loading evidence…</p>
          ) : evidenceError ? (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">Could not load evidence.</p>
          ) : evidence.length === 0 ? (
            <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
              No evidence saved yet.{" "}
              <Link href="/justice/evidence" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                Add evidence
              </Link>
            </p>
          ) : (
            <ul className="mt-3 space-y-4">
              {evidence.map((row) => (
                <li key={row.id} className="border-t border-neutral-100 pt-3 first:border-t-0 first:pt-0 dark:border-neutral-700/80">
                  <p className="font-medium text-neutral-900 dark:text-neutral-100">{row.title}</p>
                  <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">{evidenceTypeLabel(row.evidence_type)}</p>
                  {row.evidence_date ? (
                    <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">{row.evidence_date}</p>
                  ) : null}
                  {row.description?.trim() ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-700 dark:text-neutral-300">
                      {row.description.trim()}
                    </p>
                  ) : null}
                  {row.source_url?.trim() ? (
                    <p className="mt-1 text-xs break-all text-blue-600 dark:text-blue-400">
                      <a href={row.source_url.trim()} target="_blank" rel="noopener noreferrer" className="underline">
                        {row.source_url.trim()}
                      </a>
                    </p>
                  ) : null}
                  {row.storage_note?.trim() ? (
                    <p className="mt-1 whitespace-pre-wrap text-sm text-neutral-600 dark:text-neutral-400">
                      <span className="font-medium text-neutral-700 dark:text-neutral-300">Stored: </span>
                      {row.storage_note.trim()}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>

        <JusticeFilingRecords onFilingsChange={() => void loadFilings()} />

        <JusticeCaseTasks onCaseTimelineSynced={() => setTimelineTick((n) => n + 1)} />

        <section className={`mt-5 ${cardCls}`} aria-labelledby="packet-bundle">
          <h2 id="packet-bundle" className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
            Complaint packet (copy all)
          </h2>
          <textarea
            readOnly
            className="mt-3 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]"
            rows={28}
            value={packetText}
            aria-label="Full case packet text"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void copyPacket()}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg"
            >
              Copy packet
            </button>
            <button
              type="button"
              disabled={!packetText}
              onClick={() => downloadPacket()}
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              Download .txt
            </button>
            <button
              type="button"
              onClick={() => printPacket()}
              className="rounded-xl border border-neutral-300 bg-white px-4 py-2.5 text-sm font-semibold text-neutral-900 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              Print packet
            </button>
            {copyHint ? <span className="text-xs text-emerald-700 dark:text-emerald-400">{copyHint}</span> : null}
          </div>
        </section>
        </main>
      </div>

      <div
        className="justice-packet-print-root hidden text-black print:block print:bg-white print:p-0"
      >
        <div className="print:p-[0.6in]">
          <h1 className="text-xl font-bold text-neutral-900 print:text-black">Justice case packet</h1>
          <p className="mt-1 text-sm text-neutral-700 print:text-black">Case id: {caseId}</p>
          <pre className="mt-4 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-neutral-900 print:text-black print:text-[10pt]">
            {packetText}
          </pre>
        </div>
      </div>
    </>
  );
}
