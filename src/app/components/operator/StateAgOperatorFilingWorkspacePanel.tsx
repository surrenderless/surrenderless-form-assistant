"use client";

import { FormEvent, useState } from "react";
import type { OperatorFulfillmentQueueItem } from "@/lib/justice/operatorFulfillmentQueue";
import type { StateAgOperatorFilingWorkspace } from "@/lib/justice/stateAgOperatorFilingWorkspace";

type StateAgRecordInput = {
  destination: string;
  filedAt: string;
  confirmationNumber: string;
  notes: string;
};

async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    return false;
  }
}

function CopyButton({
  value,
  label,
}: {
  value: string;
  label: string;
}) {
  const [hint, setHint] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        className="rounded border border-neutral-300 bg-white px-2 py-0.5 text-[10px] font-semibold text-neutral-800 hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
        onClick={() => {
          void copyText(value).then((ok) => {
            setHint(ok ? "Copied" : "Copy failed");
            window.setTimeout(() => setHint(null), 1500);
          });
        }}
      >
        {label}
      </button>
      {hint ? <span className="text-[10px] text-neutral-500 dark:text-neutral-400">{hint}</span> : null}
    </span>
  );
}

export function StateAgOperatorFilingWorkspacePanel({
  item,
  workspace,
  saving,
  onSubmit,
}: {
  item: OperatorFulfillmentQueueItem;
  workspace: StateAgOperatorFilingWorkspace;
  saving: boolean;
  onSubmit: (input: StateAgRecordInput) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
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
      destination: workspace.filing_destination,
      filedAt: fa,
      confirmationNumber: cn,
      notes: notes.trim(),
    });
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="mt-3 space-y-4">
      <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
        State AG guided filing workspace
      </p>
      <p className="text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
        {workspace.portal.operator_guidance}
      </p>
      <p className="text-[11px] font-medium text-amber-800 dark:text-amber-300">
        Not submitted in-app. Filing is complete only after you record a portal confirmation below.
        Status claimed here: {workspace.is_submitted ? "submitted" : "not submitted"}.
      </p>

      <div className="space-y-2 rounded-lg border border-neutral-200/90 bg-neutral-50/80 p-3 dark:border-neutral-600 dark:bg-neutral-950/40">
        <p className="text-[11px] font-semibold text-neutral-800 dark:text-neutral-200">
          Official portal
        </p>
        {workspace.portal.portal_supported && workspace.portal.portal_url ? (
          <a
            href={workspace.portal.portal_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700"
          >
            Open {workspace.portal.state_name ?? "state"} complaint portal
          </a>
        ) : (
          <p className="text-[11px] text-neutral-700 dark:text-neutral-300">
            No confirmed official portal URL for this state. Use the directory lookup below — do not
            invent a URL.
          </p>
        )}
        <p className="text-[11px] text-neutral-600 dark:text-neutral-400">
          State office directory (lookup only, not a filing portal):{" "}
          <a
            href={workspace.portal.state_office_directory_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-600 underline dark:text-blue-400"
          >
            usa.gov/state-consumer
          </a>
        </p>
      </div>

      <div className="space-y-2 rounded-lg border border-neutral-200/90 bg-neutral-50/80 p-3 dark:border-neutral-600 dark:bg-neutral-950/40">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-neutral-800 dark:text-neutral-200">
            Prepared complaint draft
          </p>
          <CopyButton value={workspace.complaint_draft} label="Copy full draft" />
        </div>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-neutral-200 bg-white p-2 text-[11px] leading-relaxed text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
          {workspace.complaint_draft}
        </pre>
      </div>

      <div className="space-y-2 rounded-lg border border-neutral-200/90 bg-neutral-50/80 p-3 dark:border-neutral-600 dark:bg-neutral-950/40">
        <p className="text-[11px] font-semibold text-neutral-800 dark:text-neutral-200">
          Structured portal answers
        </p>
        <ul className="space-y-2">
          {workspace.prepared_answers.map((field) => (
            <li
              key={field.id}
              className="rounded-md border border-neutral-200 bg-white p-2 dark:border-neutral-700 dark:bg-neutral-900"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                    {field.label}
                  </p>
                  <p className="mt-0.5 whitespace-pre-wrap text-[11px] text-neutral-800 dark:text-neutral-100">
                    {field.value}
                  </p>
                </div>
                {field.copyable ? <CopyButton value={field.value} label="Copy" /> : null}
              </div>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2 rounded-lg border border-neutral-200/90 bg-neutral-50/80 p-3 dark:border-neutral-600 dark:bg-neutral-950/40">
        <p className="text-[11px] font-semibold text-neutral-800 dark:text-neutral-200">
          Evidence inventory
        </p>
        {workspace.evidence.length === 0 ? (
          <p className="text-[11px] text-neutral-600 dark:text-neutral-400">
            No saved evidence rows on this case yet.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {workspace.evidence.map((row, index) => (
              <li
                key={`${row.title}-${row.file_name ?? "nofile"}-${index}`}
                className="text-[11px] text-neutral-800 dark:text-neutral-100"
              >
                <span className="font-medium">[{row.evidence_type}]</span> {row.title}
                {row.file_name ? (
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {" "}
                    · file: {row.file_name}
                  </span>
                ) : null}
                {row.evidence_date ? (
                  <span className="text-neutral-600 dark:text-neutral-400">
                    {" "}
                    · {row.evidence_date}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>

      <form
        onSubmit={(e) => void handleSubmit(e)}
        className="space-y-2 rounded-lg border border-neutral-200/90 bg-neutral-50/80 p-3 dark:border-neutral-600 dark:bg-neutral-950/40"
      >
        <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
          Record State AG filing (after portal confirmation)
        </p>
        <label className="block text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
          Destination
          <input
            type="text"
            readOnly
            value={workspace.filing_destination}
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
          disabled={saving || workspace.is_submitted}
          className="rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? "Saving…" : "Mark fulfillment complete"}
        </button>
        <p className="text-[10px] text-neutral-500 dark:text-neutral-400">
          Task {item.task_id.slice(0, 8)}… · Case {item.case_id.slice(0, 8)}…
        </p>
      </form>
    </div>
  );
}
