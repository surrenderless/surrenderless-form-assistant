"use client";

import { FormEvent, useState } from "react";
import type { OperatorFulfillmentQueueItem } from "@/lib/justice/operatorFulfillmentQueue";
import type { MerchantContactOperatorFilingWorkspace } from "@/lib/justice/merchantContactOperatorFilingWorkspace";
import type { ContactMethod, MerchantResponseType } from "@/lib/justice/types";

type MerchantContactRecordInput = {
  destination: string;
  filedAt: string;
  confirmationNumber: string;
  notes: string;
  contactMethod: ContactMethod;
  merchantResponseType: MerchantResponseType;
  recipient: string;
};

const CONTACT_METHOD_OPTIONS: { value: ContactMethod; label: string }[] = [
  { value: "email", label: "Email" },
  { value: "chat", label: "Chat" },
  { value: "phone", label: "Phone" },
  { value: "form", label: "Web form" },
  { value: "in_person", label: "In person" },
  { value: "other", label: "Other" },
];

const MERCHANT_RESPONSE_OPTIONS: { value: MerchantResponseType; label: string }[] = [
  { value: "no_response", label: "No response" },
  { value: "refused_help", label: "Refused help" },
  { value: "promised_but_did_not_fix", label: "Promised but did not follow through" },
  { value: "partial_help", label: "Partial help" },
  { value: "asked_more_info", label: "Asked for more info" },
  { value: "resolved", label: "Resolved" },
  { value: "other", label: "Other" },
];

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

export function MerchantContactOperatorFilingWorkspacePanel({
  item,
  workspace,
  saving,
  onSubmit,
}: {
  item: OperatorFulfillmentQueueItem;
  workspace: MerchantContactOperatorFilingWorkspace;
  saving: boolean;
  onSubmit: (
    input: MerchantContactRecordInput
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [filedAt, setFiledAt] = useState("");
  const [confirmationNumber, setConfirmationNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [contactMethod, setContactMethod] = useState<ContactMethod>("email");
  const [merchantResponseType, setMerchantResponseType] =
    useState<MerchantResponseType>("no_response");
  const [recipient, setRecipient] = useState(
    workspace.delivery.recipient_email ?? workspace.delivery.company_name
  );
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const fa = filedAt.trim();
    const cn = confirmationNumber.trim();
    const recip = recipient.trim();
    if (!fa) {
      setError("Contact date is required.");
      return;
    }
    if (!cn) {
      setError("Confirmation or reference number is required.");
      return;
    }
    if (!recip) {
      setError("Recipient is required.");
      return;
    }
    setError(null);
    const result = await onSubmit({
      destination: workspace.filing_destination,
      filedAt: fa,
      confirmationNumber: cn,
      notes: notes.trim(),
      contactMethod,
      merchantResponseType,
      recipient: recip,
    });
    if (!result.ok) setError(result.error);
  }

  return (
    <div className="mt-3 space-y-4">
      <p className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
        Merchant contact guided filing workspace (operator fallback)
      </p>
      <p className="text-[11px] leading-relaxed text-neutral-600 dark:text-neutral-400">
        {workspace.delivery.operator_guidance}
      </p>
      <p className="text-[11px] font-medium text-amber-800 dark:text-amber-300">
        Not marked sent in-app from this panel. Outreach is complete only after automated email
        acceptance or after you record a confirmation below. Status claimed here:{" "}
        {workspace.is_submitted ? "submitted" : "not submitted"}.
      </p>

      <div className="space-y-2 rounded-lg border border-neutral-200/90 bg-neutral-50/80 p-3 dark:border-neutral-600 dark:bg-neutral-950/40">
        <p className="text-[11px] font-semibold text-neutral-800 dark:text-neutral-200">
          Recipient / company
        </p>
        <dl className="space-y-1.5 text-[11px] text-neutral-800 dark:text-neutral-100">
          <div className="flex items-start justify-between gap-2">
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Company
              </dt>
              <dd className="mt-0.5">{workspace.delivery.company_name}</dd>
            </div>
            <CopyButton value={workspace.delivery.company_name} label="Copy" />
          </div>
          <div className="flex items-start justify-between gap-2">
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Website
              </dt>
              <dd className="mt-0.5">{workspace.delivery.company_website}</dd>
            </div>
            {workspace.delivery.company_website !== "(not provided)" ? (
              <CopyButton value={workspace.delivery.company_website} label="Copy" />
            ) : null}
          </div>
          <div className="flex items-start justify-between gap-2">
            <div>
              <dt className="text-[10px] font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
                Contact email
              </dt>
              <dd className="mt-0.5">
                {workspace.delivery.recipient_email ?? "(not available)"}
              </dd>
            </div>
            {workspace.delivery.recipient_email ? (
              <CopyButton value={workspace.delivery.recipient_email} label="Copy" />
            ) : null}
          </div>
          <p className="text-[10px] text-neutral-600 dark:text-neutral-400">
            Automated email eligible: {workspace.delivery.automated_email_eligible ? "yes" : "no"}
          </p>
        </dl>
      </div>

      <div className="space-y-2 rounded-lg border border-neutral-200/90 bg-neutral-50/80 p-3 dark:border-neutral-600 dark:bg-neutral-950/40">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-neutral-800 dark:text-neutral-200">
            Prepared merchant message draft
          </p>
          <CopyButton value={workspace.message_draft} label="Copy full draft" />
        </div>
        <pre className="max-h-56 overflow-auto whitespace-pre-wrap rounded-md border border-neutral-200 bg-white p-2 text-[11px] leading-relaxed text-neutral-800 dark:border-neutral-700 dark:bg-neutral-900 dark:text-neutral-100">
          {workspace.message_draft}
        </pre>
      </div>

      <div className="space-y-2 rounded-lg border border-neutral-200/90 bg-neutral-50/80 p-3 dark:border-neutral-600 dark:bg-neutral-950/40">
        <p className="text-[11px] font-semibold text-neutral-800 dark:text-neutral-200">
          Structured copyable answers
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
          Record merchant contact (after outreach confirmation)
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
          Outreach channel
          <select
            required
            disabled={saving}
            value={contactMethod}
            onChange={(e) => setContactMethod(e.target.value as ContactMethod)}
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 disabled:opacity-60"
          >
            {CONTACT_METHOD_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
          Contact date
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
          Recipient
          <input
            type="text"
            required
            disabled={saving}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Merchant or company name / email"
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 disabled:opacity-60"
          />
        </label>
        <label className="block text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
          Confirmation / reference
          <input
            type="text"
            required
            disabled={saving}
            value={confirmationNumber}
            onChange={(e) => setConfirmationNumber(e.target.value)}
            placeholder="Ticket, email ref, or outreach confirmation"
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 disabled:opacity-60"
          />
        </label>
        <label className="block text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
          Merchant response
          <select
            required
            disabled={saving}
            value={merchantResponseType}
            onChange={(e) => setMerchantResponseType(e.target.value as MerchantResponseType)}
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 disabled:opacity-60"
          >
            {MERCHANT_RESPONSE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
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
