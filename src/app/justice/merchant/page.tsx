"use client";

import Link from "next/link";
import Header from "@/app/components/Header";
import { useRouter } from "next/navigation";
import { STORAGE_CASE_ID, STORAGE_FTC_MANUAL_UNLOCK } from "@/lib/justice/types";

export default function JusticeMerchantStubPage() {
  const router = useRouter();

  function escalate() {
    sessionStorage.setItem(STORAGE_FTC_MANUAL_UNLOCK, "1");
    void fetch("/api/justice/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_name: "escalation_unlocked",
        payload: { case_id: sessionStorage.getItem(STORAGE_CASE_ID), reason: "user_confirmed_merchant_failed" },
      }),
    }).catch(() => {});
    router.push("/justice/plan");
  }

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">Merchant Resolution</h1>
        <div className="mt-4 rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6">
          <p className="text-sm text-neutral-600 dark:text-neutral-400">
            Full contact-finder and proof tracking is coming next. For this MVP slice, use your normal email or the company’s
            support page, then return here.
          </p>
          <p className="mt-3 rounded-xl border border-neutral-200/80 bg-neutral-50 px-3 py-2 text-xs text-neutral-500 shadow-inner dark:border-neutral-600 dark:bg-neutral-800/50 dark:text-neutral-400">
            Case id: {typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID) ?? "—" : "—"}
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <Link
              href="/justice/plan"
              className="text-center text-sm font-semibold text-blue-600 transition hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
            >
              Back to action plan
            </Link>
            <button
              type="button"
              onClick={escalate}
              className="rounded-xl border border-neutral-200 bg-white px-4 py-3.5 text-sm font-semibold text-neutral-900 shadow-md shadow-neutral-900/5 transition hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-800/80 dark:text-neutral-100 dark:hover:bg-neutral-800"
            >
              Merchant did not fix this / I’m ready to escalate
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
