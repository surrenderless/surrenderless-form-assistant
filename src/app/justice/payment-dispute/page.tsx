"use client";

import { useEffect } from "react";
import Link from "next/link";
import Header from "@/app/components/Header";
import { STORAGE_CASE_ID } from "@/lib/justice/types";

export default function JusticePaymentDisputePage() {
  useEffect(() => {
    const cid = sessionStorage.getItem(STORAGE_CASE_ID);
    void fetch("/api/justice/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_name: "payment_dispute_checklist_viewed",
        payload: { case_id: cid },
      }),
    }).catch(() => {});
  }, []);

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Payment dispute checklist</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Use this with your bank or card issuer if the merchant won’t refund you.
        </p>
        <div className="mt-6 rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6">
          <ol className="list-decimal space-y-4 pl-5 text-sm leading-relaxed text-neutral-800 dark:text-neutral-200">
            <li>Find the charge on your statement (date and amount).</li>
            <li>Gather receipts, order confirmations, and your merchant messages.</li>
            <li>Open a dispute in your banking app or call the number on your card.</li>
            <li>Say clearly: you didn’t get what you paid for or the refund was refused.</li>
            <li>Upload your evidence when asked.</li>
          </ol>
        </div>
        <Link
          href="/justice/plan"
          className="mt-8 inline-flex rounded-xl border border-neutral-200 bg-white px-4 py-2.5 text-sm font-semibold text-blue-600 shadow-sm transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800/50 dark:text-blue-400 dark:hover:bg-neutral-800"
        >
          Back to action plan
        </Link>
      </main>
    </>
  );
}
