"use client";

import { SignInButton, useAuth } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import Header from "@/app/components/Header";
import type { DestinationStatus, JusticeIntake, TimelineEntry } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_FTC_MANUAL_UNLOCK, STORAGE_INTAKE } from "@/lib/justice/types";
import {
  cfpbLikelyRelevant,
  cfpbPrepDocumentedFromIntake,
  cfpbPrepUnlockedFromIntake,
  computeFtcUnlocked,
  computeJusticeDestinations,
  fccLikelyRelevant,
  isMerchantResolved,
  paymentDisputeAvailable,
} from "@/lib/justice/rules";
import { clearLocalJusticeSession } from "@/lib/justice/clearLocalJusticeSession";
import {
  appendActionPlanViewedOnce,
  appendEscalationUnlockedFromMerchantSaveOnce,
  appendMerchantContactSavedOnce,
  readTimeline,
  replaceTimelineForCase,
} from "@/lib/justice/timeline";

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

export default function JusticePlanPage() {
  const router = useRouter();
  const pathname = usePathname();
  const { isSignedIn, isLoaded } = useAuth();
  const [intake, setIntake] = useState<JusticeIntake | null>(null);
  const [caseId, setCaseId] = useState<string>("");
  const [manualFtc, setManualFtc] = useState(false);
  const [ftcCompleted, setFtcCompleted] = useState(false);
  const [timeline, setTimeline] = useState<TimelineEntry[]>([]);
  const loggedPlan = useRef(false);
  /** True when plan is open only because we expect GET /api/justice/cases/[id] to supply intake. */
  const pendingServerIntakeRef = useRef(false);
  /** Signed-in, no local case id — fetch GET /api/justice/cases to resume latest. */
  const [resumeLatestPending, setResumeLatestPending] = useState(false);

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
      setIntake(parsed);
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
              router.replace("/justice/intake");
            }
            return;
          }
          const data = (await res.json()) as {
            id?: string;
            intake?: JusticeIntake;
            timeline?: unknown;
          };
          if (ac.signal.aborted) return;
          if (!data?.id || !data.intake) {
            console.warn("justice plan: case hydrate response missing id or intake");
            if (pendingServerIntakeRef.current) {
              pendingServerIntakeRef.current = false;
              router.replace("/justice/intake");
            }
            return;
          }
          if (data.id !== cid) {
            console.warn("justice plan: case id mismatch from server");
            if (pendingServerIntakeRef.current) {
              pendingServerIntakeRef.current = false;
              router.replace("/justice/intake");
            }
            return;
          }
          pendingServerIntakeRef.current = false;
          sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(data.intake));
          const serverTimeline = Array.isArray(data.timeline) ? (data.timeline as TimelineEntry[]) : [];
          replaceTimelineForCase(cid, serverTimeline);
          setIntake(data.intake);
          setCaseId(cid);
          setTimeline(readTimeline(cid));
        } catch (e) {
          if (ac.signal.aborted) return;
          console.warn("justice plan: GET /api/justice/cases/[id] error", e);
          if (pendingServerIntakeRef.current) {
            pendingServerIntakeRef.current = false;
            router.replace("/justice/intake");
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
          router.replace("/justice/intake");
          return;
        }
        const list = (await res.json()) as Array<{
          id?: string;
          intake?: JusticeIntake;
          timeline?: unknown;
        }>;
        if (ac.signal.aborted) return;
        if (!Array.isArray(list) || list.length === 0) {
          setResumeLatestPending(false);
          router.replace("/justice/intake");
          return;
        }
        const latest = list[0];
        if (!latest?.id || !latest.intake) {
          console.warn("justice plan: list response missing id or intake");
          setResumeLatestPending(false);
          router.replace("/justice/intake");
          return;
        }
        sessionStorage.setItem(STORAGE_CASE_ID, latest.id);
        sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(latest.intake));
        const serverTimeline = Array.isArray(latest.timeline) ? (latest.timeline as TimelineEntry[]) : [];
        replaceTimelineForCase(latest.id, serverTimeline);
        pendingServerIntakeRef.current = false;
        setResumeLatestPending(false);
        setIntake(latest.intake);
        setCaseId(latest.id);
        setTimeline(readTimeline(latest.id));
      } catch (e) {
        if (ac.signal.aborted) return;
        console.warn("justice plan: GET /api/justice/cases error", e);
        setResumeLatestPending(false);
        router.replace("/justice/intake");
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
                href="/justice/intake"
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
  const useCompanyContactLabels = cfpbRel || fccRel;
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
    ftcPracticeDoneVisible && !cfpbRel && !fccRel
      ? "FTC practice completed. Next: consider payment dispute if money is still lost."
      : merchantResolved
        ? "You marked this as resolved with the merchant. Keep any confirmations for your records."
        : !contacted
          ? "Recommended next: contact the company first."
          : cfpbRel
            ? cfpbPrepOpen
              ? "Recommended next: prepare your CFPB complaint (file manually on the official CFPB site when ready)."
              : strengthenProofHint
            : fccRel && ftcOpen
              ? "Recommended next: prepare your FCC complaint (file manually on the official FCC site when ready)."
              : ftcOpen
                ? "Recommended next: escalate using your failed contact proof."
                : strengthenProofHint;
  const paymentRecommendedNext = ftcPracticeDoneVisible && paymentOk;
  const merchantBadge =
    !merchantResolved &&
    (!contacted || (contacted && !ftcOpen) || (cfpbRel && contacted && !cfpbPrepOpen)) &&
    !paymentRecommendedNext;
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

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/justice/intake" className="text-blue-600 hover:underline">
            Edit answers
          </Link>
          {" · "}
          <Link href="/justice/cases" className="text-blue-600 hover:underline">
            Saved cases
          </Link>
          {" · "}
          <Link
            href="/justice/intake"
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
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{headline}</p>
        <p className="mt-1 text-xs text-neutral-500">{recommendationText}</p>

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

        <ul className="mt-8 space-y-5">
          <li className="rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] transition-shadow duration-200 hover:shadow-xl hover:shadow-neutral-900/[0.07] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] dark:hover:shadow-black/50">
            <div className="flex items-start justify-between gap-2">
              <div>
                {merchantBadge && <p className="text-xs font-semibold uppercase text-blue-600">Recommended next</p>}
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">{merchantTitle}</h2>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  {merchantDescription}
                </p>
              </div>
            </div>
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

          <li className="rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] transition-shadow duration-200 hover:shadow-xl hover:shadow-neutral-900/[0.07] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] dark:hover:shadow-black/50">
            {paymentRecommendedNext && (
              <p className="text-xs font-semibold uppercase text-blue-600">Recommended next</p>
            )}
            <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">Payment dispute</h2>
            <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
              Best when money was charged and you have transaction details.
            </p>
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
                  <p className="text-xs font-semibold uppercase text-blue-600">Recommended next</p>
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
                  <p className="text-xs font-semibold uppercase text-blue-600">Recommended next</p>
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
            ) : (
              <>
                {ftcPracticeDoneVisible && (
                  <p className="text-xs font-semibold uppercase text-emerald-700 dark:text-emerald-400">
                    Practice completed
                  </p>
                )}
                {!merchantResolved && !ftcPracticeDoneVisible && contacted && ftcOpen && (
                  <p className="text-xs font-semibold uppercase text-blue-600">Recommended next</p>
                )}
                <h2 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
                  {ftcPracticeDoneVisible ? "FTC practice completed" : "Step 3 — Escalate to FTC"}
                </h2>
                <p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
                  {ftcPracticeDoneVisible
                    ? "Your internal practice FTC form was filled. This was not a real government submission."
                    : "Use this after merchant contact failed or the company refused to help."}
                </p>
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
