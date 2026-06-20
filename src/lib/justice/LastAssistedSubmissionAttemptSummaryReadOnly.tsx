"use client";

import { useMemo } from "react";
import {
  buildLastAssistedSubmissionAttemptSummaryDisplay,
  type LastAssistedSubmissionAttemptSnapshot,
} from "@/lib/justice/submissionAttemptState";

export function LastAssistedSubmissionAttemptSummaryReadOnly({
  snapshot,
}: {
  snapshot: LastAssistedSubmissionAttemptSnapshot;
}) {
  const display = useMemo(
    () => buildLastAssistedSubmissionAttemptSummaryDisplay(snapshot),
    [snapshot]
  );

  return (
    <div
      className={`mt-2 rounded-lg border px-2.5 py-2 ${
        display.isFailed
          ? "border-red-200/90 bg-red-50/90 dark:border-red-900/60 dark:bg-red-950/30"
          : "border-neutral-200/90 bg-neutral-50/90 dark:border-neutral-600 dark:bg-neutral-800/40"
      }`}
    >
      <p className="text-xs font-semibold text-neutral-700 dark:text-neutral-200">
        Last assisted submission attempt
      </p>
      {display.outcomeLabel ? (
        <p className="mt-1 text-xs font-semibold text-red-700 dark:text-red-400">
          {display.outcomeLabel}
        </p>
      ) : null}
      <p className="mt-1 text-xs font-medium text-neutral-900 dark:text-neutral-100">
        {display.destination}
      </p>
      <p className="mt-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
        Attempted {display.attemptedAtLabel}
      </p>
      {display.error ? (
        <p className="mt-0.5 text-[11px] font-medium text-red-700 dark:text-red-400">
          {display.error}
        </p>
      ) : null}
      {display.confirmation ? (
        <p className="mt-0.5 font-mono text-[11px] text-neutral-700 dark:text-neutral-300">
          Confirmation: {display.confirmation}
        </p>
      ) : null}
      {display.filingId ? (
        <p className="mt-0.5 font-mono text-[11px] text-neutral-700 dark:text-neutral-300">
          Filing id: {display.filingId}
        </p>
      ) : null}
      {display.executionContextLabel ? (
        <p className="mt-0.5 text-[11px] text-neutral-600 dark:text-neutral-400">
          {display.executionContextLabel}
        </p>
      ) : null}
      <p className="mt-1.5 text-[11px] leading-relaxed text-neutral-500 dark:text-neutral-500">
        {display.isFailed
          ? "Read-only — mock practice lane failure snapshot. Retry from the run button when ready."
          : "Read-only — mock practice lane snapshot from chat assisted submission."}
      </p>
    </div>
  );
}
