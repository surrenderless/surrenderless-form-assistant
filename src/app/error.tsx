"use client";

import { useEffect } from "react";

/**
 * App Router error boundary: catches an otherwise-unrecoverable render-time exception
 * anywhere under the root layout and gives the consumer a working way back into their
 * case, instead of Next's bare default fallback with no retry affordance.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled application error:", error);
  }, [error]);

  return (
    <div className="flex min-h-[70vh] items-center justify-center px-4 py-12">
      <div
        role="alert"
        aria-live="assertive"
        className="w-full max-w-md rounded-xl border border-neutral-200 bg-white p-6 text-center shadow-md dark:border-neutral-700 dark:bg-neutral-900"
      >
        <h1 className="text-lg font-semibold text-neutral-900 dark:text-neutral-100">
          Something went wrong
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          This page hit an unexpected error. Your case data is safe — nothing was lost. You can
          try again, or head back to your chat to keep going.
        </p>
        <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={reset}
            className="rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700"
          >
            Try again
          </button>
          <a
            href="/justice/chat-ai"
            className="inline-flex items-center justify-center rounded-xl border border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm transition hover:bg-blue-50 dark:border-blue-500 dark:bg-neutral-900 dark:text-blue-400 dark:hover:bg-neutral-800"
          >
            Return to chat
          </a>
        </div>
      </div>
    </div>
  );
}
