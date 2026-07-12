"use client";

import { FormEvent, useState } from "react";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import type { OperatorFulfillmentQueueItem } from "@/lib/justice/operatorFulfillmentQueue";

type RecordInput = {
  destination: string;
  filedAt: string;
  confirmationNumber: string;
  notes: string;
};

function stepLabel(step: OperatorFulfillmentQueueItem["step"]): string {
  switch (step) {
    case "state_ag":
      return "State Attorney General filing";
    case "demand_letter":
      return "Demand letter";
    case "cfpb":
      return "CFPB filing";
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}

function recordFormTitle(step: OperatorFulfillmentQueueItem["step"]): string {
  switch (step) {
    case "state_ag":
      return "Record State AG filing";
    case "demand_letter":
      return "Record demand letter fulfillment";
    case "cfpb":
      return "Record CFPB filing";
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}

function canonicalDestinationForStep(step: OperatorFulfillmentQueueItem["step"]): string {
  switch (step) {
    case "state_ag":
      return (
        canonicalFilingDestinationForApprovedActionHref(
          MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF
        ) ?? "State Attorney General (consumer)"
      );
    case "demand_letter":
      return (
        canonicalFilingDestinationForApprovedActionHref(
          MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF
        ) ?? "Small claims / demand letter"
      );
    case "cfpb":
      return (
        canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF) ??
        "CFPB"
      );
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}

function OperatorFulfillmentRecordForm({
  item,
  saving,
  onSubmit,
}: {
  item: OperatorFulfillmentQueueItem;
  saving: boolean;
  onSubmit: (input: RecordInput) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const canonicalDestination = canonicalDestinationForStep(item.step);
  const [filedAt, setFiledAt] = useState("");
  const [confirmationNumber, setConfirmationNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const fa = filedAt.trim();
    const cn = confirmationNumber.trim();
    if (!fa) {
      setError("Filed date is required.");
      return;
    }
    if (!cn) {
      setError("Confirmation number is required.");
      return;
    }
    setError(null);
    const result = await onSubmit({
      destination: canonicalDestination,
      filedAt: fa,
      confirmationNumber: cn,
      notes: notes.trim(),
    });
    if (!result.ok) setError(result.error);
  }

  return (
    <form
      onSubmit={(e) => void handleSubmit(e)}
      className="mt-3 space-y-2 rounded-lg border border-neutral-200/90 bg-neutral-50/80 p-3 dark:border-neutral-600 dark:bg-neutral-950/40"
    >
      <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
        {recordFormTitle(item.step)}
      </p>
      <label className="block text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
        Destination
        <input
          type="text"
          readOnly
          value={canonicalDestination}
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100"
        />
      </label>
      <label className="block text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
        Filed date
        <input
          type="date"
          required
          disabled={saving}
          value={filedAt}
          onChange={(e) => setFiledAt(e.target.value)}
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 disabled:opacity-60"
        />
      </label>
      <label className="block text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
        Confirmation number
        <input
          type="text"
          required
          disabled={saving}
          value={confirmationNumber}
          onChange={(e) => setConfirmationNumber(e.target.value)}
          placeholder="Portal confirmation or reference number"
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 disabled:opacity-60"
        />
      </label>
      <label className="block text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
        Notes (optional)
        <textarea
          rows={2}
          disabled={saving}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 disabled:opacity-60"
        />
      </label>
      {error ? <p className="text-xs font-medium text-red-700 dark:text-red-400">{error}</p> : null}
      <button
        type="submit"
        disabled={saving}
        className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {saving ? "Saving…" : "Mark fulfillment complete"}
      </button>
    </form>
  );
}

export function OperatorFulfillmentQueuePanel({
  items,
  savingTaskId,
  onRecordComplete,
}: {
  items: OperatorFulfillmentQueueItem[];
  savingTaskId: string | null;
  onRecordComplete: (
    item: OperatorFulfillmentQueueItem,
    input: RecordInput
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        No queued CFPB, State AG, or demand letter fulfillment tasks right now.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <li
          key={item.task_id}
          className="rounded-xl border border-neutral-200/90 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900"
        >
          <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
            {item.company_name}
          </p>
          <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
            Step: {stepLabel(item.step)}
          </p>
          {item.consumer_us_state ? (
            <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
              Consumer state: {item.consumer_us_state}
            </p>
          ) : null}
          {item.draft_excerpt ? (
            <p className="mt-2 text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
              <span className="font-medium">Draft excerpt:</span> {item.draft_excerpt}
            </p>
          ) : null}
          <OperatorFulfillmentRecordForm
            item={item}
            saving={savingTaskId === item.task_id}
            onSubmit={(input) => onRecordComplete(item, input)}
          />
        </li>
      ))}
    </ul>
  );
}
