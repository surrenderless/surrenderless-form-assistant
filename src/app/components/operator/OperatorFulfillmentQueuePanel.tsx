"use client";

import { FormEvent, useState } from "react";
import {
  canonicalFilingDestinationForApprovedActionHref,
  MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF,
  MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF,
} from "@/lib/justice/handlingTrackingProgress";
import type { OperatorFulfillmentQueueItem } from "@/lib/justice/operatorFulfillmentQueue";
import { resolveOperatorFulfillmentPanelKind } from "@/lib/justice/operatorFulfillmentQueue";
import type { OperatorClosableCaseItem } from "@/lib/justice/operatorOwnedCaseArchive";
import type { ContactMethod, MerchantResponseType } from "@/lib/justice/types";
import { CfpbOperatorFilingWorkspacePanel } from "@/app/components/operator/CfpbOperatorFilingWorkspacePanel";
import { DotOperatorFilingWorkspacePanel } from "@/app/components/operator/DotOperatorFilingWorkspacePanel";
import { FccOperatorFilingWorkspacePanel } from "@/app/components/operator/FccOperatorFilingWorkspacePanel";
import { FtcOperatorFilingWorkspacePanel } from "@/app/components/operator/FtcOperatorFilingWorkspacePanel";
import { StateAgOperatorFilingWorkspacePanel } from "@/app/components/operator/StateAgOperatorFilingWorkspacePanel";

export type RecordInput = {
  destination: string;
  filedAt: string;
  confirmationNumber: string;
  notes: string;
  contactMethod?: ContactMethod;
  merchantResponseType?: MerchantResponseType;
  recipient?: string;
};

export type ResponseReviewInput = {
  outcome: "resolved" | "no_resolution" | "further_escalation";
  notes: string;
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

function stepLabel(step: OperatorFulfillmentQueueItem["step"]): string {
  switch (step) {
    case "merchant_contact":
      return "Merchant contact";
    case "state_ag":
      return "State Attorney General filing";
    case "demand_letter":
      return "Demand letter";
    case "cfpb":
      return "CFPB filing";
    case "payment_dispute":
      return "Payment dispute filing";
    case "fcc":
      return "FCC filing";
    case "dot":
      return "DOT filing";
    case "ftc":
      return "FTC filing";
    case "bbb":
      return "BBB filing";
    case "follow_up_response_review":
      return "Follow-up response review";
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}

function recordFormTitle(step: OperatorFulfillmentQueueItem["step"]): string {
  switch (step) {
    case "merchant_contact":
      return "Record merchant contact outreach";
    case "state_ag":
      return "Record State AG filing";
    case "demand_letter":
      return "Record demand letter fulfillment";
    case "cfpb":
      return "Record CFPB filing";
    case "payment_dispute":
      return "Record payment dispute filing";
    case "fcc":
      return "Record FCC filing";
    case "dot":
      return "Record DOT filing";
    case "ftc":
      return "Record FTC filing";
    case "bbb":
      return "Record BBB filing";
    case "follow_up_response_review":
      return "Record follow-up response review";
    default: {
      const _exhaustive: never = step;
      return _exhaustive;
    }
  }
}

function canonicalDestinationForStep(step: OperatorFulfillmentQueueItem["step"]): string {
  switch (step) {
    case "merchant_contact":
      return (
        canonicalFilingDestinationForApprovedActionHref(
          MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF
        ) ?? "Merchant contact"
      );
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
    case "payment_dispute":
      return (
        canonicalFilingDestinationForApprovedActionHref(
          MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF
        ) ?? "Payment dispute (bank/card)"
      );
    case "fcc":
      return (
        canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF) ??
        "FCC"
      );
    case "dot":
      return (
        canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF) ??
        "USDOT / aviation consumer"
      );
    case "ftc":
      return (
        canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF) ??
        "FTC (consumer complaint)"
      );
    case "bbb":
      return (
        canonicalFilingDestinationForApprovedActionHref(MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF) ??
        "Better Business Bureau"
      );
    case "follow_up_response_review":
      return "Follow-up response review";
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
  const isMerchant = item.step === "merchant_contact";
  const canonicalDestination = canonicalDestinationForStep(item.step);
  const [filedAt, setFiledAt] = useState("");
  const [confirmationNumber, setConfirmationNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [contactMethod, setContactMethod] = useState<ContactMethod>("email");
  const [merchantResponseType, setMerchantResponseType] =
    useState<MerchantResponseType>("no_response");
  const [recipient, setRecipient] = useState(item.company_name);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const fa = filedAt.trim();
    const cn = confirmationNumber.trim();
    if (!fa) {
      setError(isMerchant ? "Contact date is required." : "Filed date is required.");
      return;
    }
    if (!cn) {
      setError(
        isMerchant
          ? "Confirmation or reference number is required."
          : "Confirmation number is required."
      );
      return;
    }
    if (isMerchant && !recipient.trim()) {
      setError("Recipient is required.");
      return;
    }
    setError(null);
    const result = await onSubmit({
      destination: canonicalDestination,
      filedAt: fa,
      confirmationNumber: cn,
      notes: notes.trim(),
      ...(isMerchant
        ? {
            contactMethod,
            merchantResponseType,
            recipient: recipient.trim(),
          }
        : {}),
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
      {isMerchant ? (
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
      ) : null}
      <label className="block text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
        {isMerchant ? "Contact date" : "Filed date"}
        <input
          type="date"
          required
          disabled={saving}
          value={filedAt}
          onChange={(e) => setFiledAt(e.target.value)}
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 disabled:opacity-60"
        />
      </label>
      {isMerchant ? (
        <label className="block text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
          Recipient
          <input
            type="text"
            required
            disabled={saving}
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder="Merchant or company name"
            className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 disabled:opacity-60"
          />
        </label>
      ) : null}
      <label className="block text-[11px] font-medium text-neutral-700 dark:text-neutral-300">
        {isMerchant ? "Confirmation / reference" : "Confirmation number"}
        <input
          type="text"
          required
          disabled={saving}
          value={confirmationNumber}
          onChange={(e) => setConfirmationNumber(e.target.value)}
          placeholder={
            isMerchant
              ? "Ticket, email ref, or outreach confirmation"
              : "Portal confirmation or reference number"
          }
          className="mt-1 w-full rounded-lg border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 disabled:opacity-60"
        />
      </label>
      {isMerchant ? (
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
      ) : null}
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

function FollowUpResponseReviewForm({
  item,
  saving,
  onSubmit,
}: {
  item: OperatorFulfillmentQueueItem;
  saving: boolean;
  onSubmit: (input: ResponseReviewInput) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [outcome, setOutcome] = useState<ResponseReviewInput["outcome"]>("no_resolution");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const result = await onSubmit({ outcome, notes: notes.trim() });
    if (!result.ok) setError(result.error);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-3 space-y-3">
      <div className="space-y-2 rounded-lg border border-amber-200/90 bg-amber-50/70 p-3 dark:border-amber-800 dark:bg-amber-950/30">
        <p className="text-xs font-medium text-amber-950 dark:text-amber-100">
          {recordFormTitle(item.step)}
        </p>
        <p className="text-[11px] leading-relaxed text-amber-900/90 dark:text-amber-100/90">
          Follow-up date passed with no confirmed resolution. Review agency, merchant, or bank
          responses. Do not mark resolved unless resolution is actually confirmed. This does not
          archive the case.
        </p>
        {item.draft_excerpt ? (
          <p className="text-[11px] leading-relaxed text-neutral-700 dark:text-neutral-300">
            {item.draft_excerpt}
          </p>
        ) : null}
      </div>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium text-neutral-800 dark:text-neutral-200">
          Outcome
        </legend>
        {(
          [
            { value: "resolved" as const, label: "Resolved" },
            { value: "no_resolution" as const, label: "No resolution" },
            { value: "further_escalation" as const, label: "Further escalation needed" },
          ] as const
        ).map((opt) => (
          <label
            key={opt.value}
            className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800 dark:text-neutral-200"
          >
            <input
              type="radio"
              name={`response-review-outcome-${item.task_id}`}
              value={opt.value}
              checked={outcome === opt.value}
              onChange={() => setOutcome(opt.value)}
              disabled={saving}
            />
            {opt.label}
          </label>
        ))}
      </fieldset>
      <label className="block text-xs font-medium text-neutral-700 dark:text-neutral-300">
        Operator notes (optional)
        <textarea
          className="mt-1 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm dark:border-neutral-600 dark:bg-neutral-950"
          rows={3}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          disabled={saving}
        />
      </label>
      {error ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={saving}
        className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {saving ? "Saving…" : "Complete response review"}
      </button>
    </form>
  );
}

export function OperatorFulfillmentQueuePanel({
  items,
  savingTaskId,
  onRecordComplete,
  onCompleteResponseReview,
}: {
  items: OperatorFulfillmentQueueItem[];
  savingTaskId: string | null;
  onRecordComplete: (
    item: OperatorFulfillmentQueueItem,
    input: RecordInput
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  onCompleteResponseReview: (
    item: OperatorFulfillmentQueueItem,
    input: ResponseReviewInput
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        No queued merchant contact, FTC, BBB, DOT, FCC, payment dispute, CFPB, State AG, demand
        letter, or follow-up response-review tasks right now.
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
          {(() => {
            const panelKind = resolveOperatorFulfillmentPanelKind(item);
            if (panelKind === "state_ag_workspace" && item.state_ag_workspace) {
              return (
                <StateAgOperatorFilingWorkspacePanel
                  item={item}
                  workspace={item.state_ag_workspace}
                  saving={savingTaskId === item.task_id}
                  onSubmit={(input) => onRecordComplete(item, input)}
                />
              );
            }
            if (panelKind === "cfpb_workspace" && item.cfpb_workspace) {
              return (
                <CfpbOperatorFilingWorkspacePanel
                  item={item}
                  workspace={item.cfpb_workspace}
                  saving={savingTaskId === item.task_id}
                  onSubmit={(input) => onRecordComplete(item, input)}
                />
              );
            }
            if (panelKind === "fcc_workspace" && item.fcc_workspace) {
              return (
                <FccOperatorFilingWorkspacePanel
                  item={item}
                  workspace={item.fcc_workspace}
                  saving={savingTaskId === item.task_id}
                  onSubmit={(input) => onRecordComplete(item, input)}
                />
              );
            }
            if (panelKind === "ftc_workspace" && item.ftc_workspace) {
              return (
                <FtcOperatorFilingWorkspacePanel
                  item={item}
                  workspace={item.ftc_workspace}
                  saving={savingTaskId === item.task_id}
                  onSubmit={(input) => onRecordComplete(item, input)}
                />
              );
            }
            if (panelKind === "dot_workspace" && item.dot_workspace) {
              return (
                <DotOperatorFilingWorkspacePanel
                  item={item}
                  workspace={item.dot_workspace}
                  saving={savingTaskId === item.task_id}
                  onSubmit={(input) => onRecordComplete(item, input)}
                />
              );
            }
            if (panelKind === "follow_up_response_review") {
              return (
                <FollowUpResponseReviewForm
                  item={item}
                  saving={savingTaskId === item.task_id}
                  onSubmit={(input) => onCompleteResponseReview(item, input)}
                />
              );
            }
            return (
              <>
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
              </>
            );
          })()}
        </li>
      ))}
    </ul>
  );
}

function ClosableCaseCard({
  item,
  saving,
  onCloseCase,
}: {
  item: OperatorClosableCaseItem;
  saving: boolean;
  onCloseCase: (
    item: OperatorClosableCaseItem,
    confirmArchive: boolean
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClose() {
    if (!confirmed) {
      setError("Confirm that this case should be closed before archiving.");
      return;
    }
    setError(null);
    const result = await onCloseCase(item, true);
    if (!result.ok) setError(result.error);
  }

  const outcomeLabel = item.outcome === "resolved" ? "Resolved" : "No resolution";

  return (
    <li className="rounded-xl border border-neutral-200/90 bg-white p-4 shadow-sm dark:border-neutral-700 dark:bg-neutral-900">
      <p className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {item.company_name}
      </p>
      <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
        Operator outcome: {outcomeLabel}
      </p>
      {item.consumer_us_state ? (
        <p className="mt-1 text-xs text-neutral-600 dark:text-neutral-400">
          Consumer state: {item.consumer_us_state}
        </p>
      ) : null}
      {item.outcome_note ? (
        <p className="mt-2 text-[11px] leading-relaxed text-neutral-700 dark:text-neutral-300">
          {item.outcome_note}
        </p>
      ) : null}
      <label className="mt-3 flex cursor-pointer items-start gap-2 text-sm text-neutral-800 dark:text-neutral-200">
        <input
          type="checkbox"
          className="mt-1"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
          disabled={saving}
        />
        <span>
          I confirm this case should be closed and archived in Surrenderless. This does not undo
          filings or contact anyone.
        </span>
      </label>
      {error ? (
        <p className="mt-2 text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        disabled={saving || !confirmed}
        onClick={() => void handleClose()}
        className="mt-3 rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-60 dark:bg-neutral-100 dark:text-neutral-900"
      >
        {saving ? "Closing…" : "Close case"}
      </button>
    </li>
  );
}

export function OperatorClosableCasesPanel({
  items,
  savingCaseId,
  onCloseCase,
}: {
  items: OperatorClosableCaseItem[];
  savingCaseId: string | null;
  onCloseCase: (
    item: OperatorClosableCaseItem,
    confirmArchive: boolean
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  if (items.length === 0) {
    return (
      <p className="text-sm text-neutral-600 dark:text-neutral-400">
        No cases awaiting operator close after a recorded response-review outcome.
      </p>
    );
  }

  return (
    <ul className="space-y-4">
      {items.map((item) => (
        <ClosableCaseCard
          key={item.case_id}
          item={item}
          saving={savingCaseId === item.case_id}
          onCloseCase={onCloseCase}
        />
      ))}
    </ul>
  );
}
