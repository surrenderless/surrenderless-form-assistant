"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Header from "@/app/components/Header";
import JusticeFilingRecords from "@/app/components/JusticeFilingRecords";
import JusticeSavedEvidenceList from "@/app/components/JusticeSavedEvidenceList";
import JusticeActionResumeSignInPrompt from "@/app/components/JusticeActionResumeSignInPrompt";
import type { JusticeIntake } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_INTAKE } from "@/lib/justice/types";
import {
  appendStateAgComplaintFiledOnce,
  appendStateAgPrepOpenedOnce,
  readTimeline,
  syncCaseTimelineToServer,
} from "@/lib/justice/timeline";
import {
  buildStateAgComplaintDraft,
  stateAgDesiredResolutionPhrase,
  stateNameFromCode,
  US_STATES,
} from "@/lib/justice/buildStateAgComplaintDraft";
import { useJusticeActionPageHydration } from "@/lib/justice/useJusticeActionPageHydration";

const cardCls =
  "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";

export default function JusticeStateAgPrepPage() {
  const { isSignedIn, isLoaded } = useAuth();
  const { status: hydrationStatus, intake: hydratedIntake } = useJusticeActionPageHydration();
  const [intake, setIntake] = useState<JusticeIntake | null>(null);
  const [copyHint, setCopyHint] = useState<string | null>(null);
  const [caseId, setCaseId] = useState("");
  const [stateAgComplaintFiled, setStateAgComplaintFiled] = useState(false);

  useEffect(() => {
    if (hydrationStatus !== "ready" || !hydratedIntake) return;
    setIntake(hydratedIntake);
    const cid = sessionStorage.getItem(STORAGE_CASE_ID) ?? "";
    setCaseId(cid);
    if (cid) {
      appendStateAgPrepOpenedOnce(cid);
      setStateAgComplaintFiled(readTimeline(cid).some((e) => e.type === "state_ag_complaint_filed"));
    } else {
      setStateAgComplaintFiled(false);
    }

    if (isLoaded && isSignedIn && cid) {
      void syncCaseTimelineToServer(cid);
    }
  }, [hydrationStatus, hydratedIntake, isLoaded, isSignedIn]);

  const complaintText = useMemo(() => (intake ? buildStateAgComplaintDraft(intake) : ""), [intake]);

  function persistStateCode(code: string) {
    if (!intake) return;
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) {
      const { consumer_us_state: _, ...rest } = intake;
      const next = { ...rest } as JusticeIntake;
      sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(next));
      setIntake(next);
      return;
    }
    const updated: JusticeIntake = { ...intake, consumer_us_state: trimmed };
    sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(updated));
    setIntake(updated);
  }

  async function copyComplaint() {
    try {
      await navigator.clipboard.writeText(complaintText);
      setCopyHint("Copied to clipboard.");
      window.setTimeout(() => setCopyHint(null), 2500);
    } catch {
      setCopyHint("Copy failed — select the text and copy manually.");
    }
  }

  async function markStateAgComplaintFiled() {
    const cid = sessionStorage.getItem(STORAGE_CASE_ID) ?? "";
    if (!cid) return;
    if (!appendStateAgComplaintFiledOnce(cid)) return;
    setStateAgComplaintFiled(true);
    if (isLoaded && isSignedIn) {
      await syncCaseTimelineToServer(cid);
    }
  }

  if (hydrationStatus === "needs_sign_in") {
    return <JusticeActionResumeSignInPrompt />;
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

  const issueSummary = `${intake.company_name} — ${intake.problem_category.replace(/_/g, " ")}`;
  const desiredResolution = stateAgDesiredResolutionPhrase(intake.problem_category);

  const evidenceItems: string[] = [
    "Order number, confirmation email, or receipt (from your intake where applicable).",
    "Screenshots or exports of chats/emails with the business.",
    intake.already_contacted === "yes" && intake.contact_date
      ? `Documented merchant contact (${intake.contact_method ?? "method"} on ${intake.contact_date}).`
      : "Proof you contacted the business (dates, method, ticket numbers).",
    intake.contact_proof_type && intake.contact_proof_type !== "none"
      ? `Proof type you noted: ${intake.contact_proof_type.replace(/_/g, " ")}.`
      : null,
    intake.contact_proof_text?.trim() ? `Notes: ${intake.contact_proof_text.trim()}` : null,
    "Bank or card dispute confirmation, if you opened one.",
  ].filter((x): x is string => Boolean(x));

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/justice/chat-ai" className="text-blue-600 hover:underline dark:text-blue-400">
            Update in chat
          </Link>
          {" · "}
          <Link href="/justice" className="text-blue-600 hover:underline dark:text-blue-400">
            Justice workspace
          </Link>
        </p>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">State AG complaint prep</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Prepare a draft for your state Attorney General or consumer protection office. This page does not submit
          anything for you.
        </p>

        <div className="mt-4 rounded-2xl border border-amber-200/90 bg-amber-50/95 p-4 text-sm text-amber-950 shadow-md shadow-amber-900/10 ring-1 ring-amber-950/[0.06] dark:border-amber-800 dark:bg-amber-950/45 dark:text-amber-100 dark:shadow-black/30 dark:ring-amber-500/10">
          <strong>Manual filing required.</strong> Each state runs its own complaint website or PDF process. Search for
          your state’s official Attorney General or consumer protection complaint form and verify the URL before entering
          personal information.
        </div>

        <div className={`mt-6 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Your state</p>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            Select the state where you live or where you want to file (many portals ask for resident or jurisdictional
            details).
          </p>
          <label className="mt-3 block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            State
            <select
              className="mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]"
              value={intake.consumer_us_state ?? ""}
              onChange={(e) => persistStateCode(e.target.value)}
            >
              <option value="">Select state…</option>
              {US_STATES.map((s) => (
                <option key={s.code} value={s.code}>
                  {s.name} ({s.code})
                </option>
              ))}
            </select>
          </label>
          {intake.consumer_us_state?.trim() ? (
            <p className="mt-2 text-sm font-medium text-neutral-900 dark:text-neutral-100">
              Selected: {stateNameFromCode(intake.consumer_us_state)} ({intake.consumer_us_state.trim().toUpperCase()})
            </p>
          ) : (
            <p className="mt-2 text-xs text-amber-800 dark:text-amber-200">
              Choose a state to tailor the draft; you can change it anytime.
            </p>
          )}
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Complaint summary</p>
          <p className="mt-2 text-sm text-neutral-800 dark:text-neutral-200">{issueSummary}</p>
          <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
            Purchase / signup: {intake.purchase_or_signup}
          </p>
          <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
            Money: {intake.money_involved} · Date: {intake.pay_or_order_date}
          </p>
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Company info</p>
          <ul className="mt-3 space-y-2 text-sm text-neutral-800 dark:text-neutral-200">
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Name:</span> {intake.company_name || "—"}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Website:</span>{" "}
              {intake.company_website.trim() || "—"}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Your name:</span> {intake.user_display_name}
            </li>
            <li>
              <span className="text-neutral-500 dark:text-neutral-400">Your email:</span> {intake.reply_email}
            </li>
          </ul>
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">What happened</p>
          <p className="mt-2 whitespace-pre-wrap text-sm text-neutral-800 dark:text-neutral-200">{intake.story.trim()}</p>
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Desired resolution</p>
          <p className="mt-2 text-sm text-neutral-800 dark:text-neutral-200">{desiredResolution}</p>
        </div>

        <div className={`mt-5 ${cardCls}`}>
          <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Evidence checklist</p>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-neutral-800 dark:text-neutral-200">
            {evidenceItems.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>

        <JusticeSavedEvidenceList />

        <div className={`mt-5 ${cardCls}`}>
          <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300">
            Copy-ready complaint text
          </label>
          <textarea
            readOnly
            className="mt-2 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 font-mono text-xs leading-relaxed text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]"
            rows={20}
            value={complaintText}
            aria-label="Draft state AG complaint text"
          />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void copyComplaint()}
              className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 hover:shadow-lg"
            >
              Copy text
            </button>
            <button
              type="button"
              disabled={!caseId || stateAgComplaintFiled}
              onClick={() => void markStateAgComplaintFiled()}
              className="rounded-xl border border-neutral-300 bg-white px-3 py-2 text-xs font-semibold text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              Mark State AG complaint filed
            </button>
            {copyHint ? (
              <span className="text-xs text-emerald-700 dark:text-emerald-400">{copyHint}</span>
            ) : null}
          </div>
        </div>

        <JusticeFilingRecords />
      </main>
    </>
  );
}
