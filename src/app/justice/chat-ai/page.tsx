"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { validate as isUuid } from "uuid";
import Header from "@/app/components/Header";
import JusticeActionResumeSignInPrompt from "@/app/components/JusticeActionResumeSignInPrompt";
import { ApprovedNextActionFollowUpTimingLine } from "@/lib/justice/approvedNextActionFollowUp";
import {
  APPROVED_NEXT_ACTION_HANDLING_ACKNOWLEDGE_HELPER,
  APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER,
  ApprovedNextActionHandlingQueueStatusReadOnly,
  ApprovedNextActionHandlingRequestBlock,
} from "@/lib/justice/approvedNextActionHandlingDisplay";
import {
  acknowledgeHandlingRequestInApprovedNextAction,
  applyHandlingRequestNoteToApprovedNextAction,
  omitClearedHandlingRequestNoteFromApprovedNextAction,
  approvedNextActionStatusLabel,
  clearFollowUpFromApprovedNextAction,
  hydrateApprovedNextActionForDisplay,
  mergeApprovedNextActionTrackingFields,
  mergeClientStateWithAcknowledgedHandling,
  mergeClientStateWithApprovedNextAction,
  mergeClientStateWithClearedFollowUp,
  writeSessionApprovedNextAction,
} from "@/lib/justice/approvedNextActionState";
import type { JusticeApprovedNextAction } from "@/lib/justice/types";
import { STORAGE_CASE_ID } from "@/lib/justice/types";
import {
  buildJusticeIntakeFromParts,
  justiceIntakeToBuildJusticeIntakeParts,
  type BuildJusticeIntakeParts,
  validateContactProofForIntake,
} from "@/lib/justice/buildJusticeIntake";
import { commitIntakeToSessionAndServer } from "@/lib/justice/commitIntakeToSessionAndServer";
import { readValidLocalJusticeIntake } from "@/lib/justice/hydrateActiveCaseFromServer";
import {
  defaultBuildJusticeIntakeParts,
  MAX_INTAKE_CHAT_USER_MESSAGE,
} from "@/lib/justice/parseIntakeChatAiResponse";
import type { JusticeIntake } from "@/lib/justice/types";

type UiMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
};

const CATEGORIES: { value: JusticeIntake["problem_category"]; label: string }[] = [
  { value: "online_purchase", label: "Something I bought online" },
  {
    value: "financial_account_issue",
    label: "Bank, credit, loan, payment, debt, billing, or financial account issue",
  },
  { value: "subscription", label: "A subscription or recurring charge" },
  { value: "service_failed", label: "A service that didn’t work as promised" },
  { value: "charge_dispute", label: "A charge I didn’t agree to" },
  { value: "something_else", label: "Something else" },
];

const OPENING_GREETING =
  "Hi — tell me what’s going on with your consumer issue. I’ll ask follow-up questions and keep track of your case details. When we’re done, you can review everything and continue to your submission preview.";

const UPDATE_GREETING =
  "Your current case is loaded in the recap below. Tell me what you’d like to add or change — I’ll update the details as we go. When you’re ready, continue to your submission preview.";

const RECAP_STORY_MAX_LEN = 120;

function getPreviewBasicsMissing(parts: BuildJusticeIntakeParts): string[] {
  const missing: string[] = [];
  if (!parts.company_name.trim()) missing.push("company");
  if (!parts.purchase_or_signup.trim()) missing.push("product/service");
  if (!parts.story.trim()) missing.push("what happened");
  if (!parts.reply_email.trim().includes("@")) missing.push("reply email");
  if (!parts.money_amount.trim() && !parts.desired_resolution.trim()) missing.push("requested outcome");
  return missing;
}

function stillNeededBeforePreviewMessage(missing: string[]): string {
  return `Still needed before preview: ${missing.join(", ")}.`;
}

function recapStoryDisplay(story: string): string {
  const trimmed = story.trim();
  if (!trimmed) return "—";
  if (trimmed.length <= RECAP_STORY_MAX_LEN) return trimmed;
  return `${trimmed.slice(0, RECAP_STORY_MAX_LEN)}…`;
}

function formatIntakeChatApiError(status: number, serverError?: string): string {
  const err = serverError?.trim() ?? "";
  if (status === 401) {
    return "Your session may have expired. Sign in again, then resend your message.";
  }
  if (status === 429) {
    return "You’re sending messages too quickly. Wait a moment, then try again.";
  }
  if (status === 502) {
    return "We couldn’t get a usable AI reply. Check your message and try again.";
  }
  if (status === 500) {
    if (err.includes("OPENAI_API_KEY")) {
      return "AI intake isn’t available right now. Please try again later.";
    }
    return "Something went wrong on our side. Please try again.";
  }
  if (status === 413 || err.toLowerCase().includes("too large")) {
    return "That message is too large. Shorten it and try again.";
  }
  if (status === 400) {
    return "Something went wrong sending your message. Please try again.";
  }
  return "Something went wrong. Please try again.";
}

function msgId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function categoryLabel(cat: JusticeIntake["problem_category"]): string {
  return CATEGORIES.find((c) => c.value === cat)?.label ?? cat.replace(/_/g, " ");
}

export default function JusticeChatAiPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);
  const sendInFlightRef = useRef(false);
  const sessionHydratedRef = useRef(false);

  const [parts, setParts] = useState<BuildJusticeIntakeParts>(() => defaultBuildJusticeIntakeParts());
  const [isUpdatingExistingCase, setIsUpdatingExistingCase] = useState(false);
  const [messages, setMessages] = useState<UiMessage[]>(() => [
    { id: msgId(), role: "assistant", text: OPENING_GREETING },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [contactProofError, setContactProofError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [clearingFollowUp, setClearingFollowUp] = useState(false);
  const [requestingHandling, setRequestingHandling] = useState(false);
  const [updatingHandlingNote, setUpdatingHandlingNote] = useState(false);
  const [acknowledgingHandling, setAcknowledgingHandling] = useState(false);
  const [approvedNextAction, setApprovedNextAction] = useState<JusticeApprovedNextAction | undefined>(
    undefined
  );

  async function handleRequestSurrenderlessHandling(note?: string) {
    if (!approvedNextAction || approvedNextAction.status === "completed") return;
    if (approvedNextAction.handling_requested_at?.trim()) return;

    const next: JusticeApprovedNextAction = {
      ...approvedNextAction,
      handling_requested_at: new Date().toISOString(),
      ...(note ? { handling_request_note: note } : {}),
    };
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, next);
    const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);

    setApprovedNextAction(local);

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (caseId) {
      writeSessionApprovedNextAction(caseId, local);
    }

    if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId)) return;

    setRequestingHandling(true);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice chat-ai: GET before handling request failed", getRes.status);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        console.warn("justice chat-ai: PATCH handling request failed", patchRes.status);
      }
    } catch (e) {
      console.warn("justice chat-ai: handling request error", e);
    } finally {
      setRequestingHandling(false);
    }
  }

  async function handleUpdateHandlingRequestNote(note?: string) {
    if (!approvedNextAction?.handling_requested_at?.trim()) return;

    const withNoteUpdate = applyHandlingRequestNoteToApprovedNextAction(
      approvedNextAction,
      note ?? ""
    );
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, withNoteUpdate);
    const next = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
    setApprovedNextAction(next);

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (caseId) {
      writeSessionApprovedNextAction(caseId, next);
    }

    if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId)) return;

    setUpdatingHandlingNote(true);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice chat-ai: GET before handling note update failed", getRes.status);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithApprovedNextAction(existing.client_state, withTracking);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        console.warn("justice chat-ai: PATCH handling note update failed", patchRes.status);
      }
    } catch (e) {
      console.warn("justice chat-ai: handling note update error", e);
    } finally {
      setUpdatingHandlingNote(false);
    }
  }

  async function handleAcknowledgeHandlingRequest() {
    if (!approvedNextAction?.handling_requested_at?.trim()) return;
    if (approvedNextAction.handling_acknowledged_at?.trim()) return;

    const acknowledged = acknowledgeHandlingRequestInApprovedNextAction(approvedNextAction);
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, acknowledged);
    const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
    setApprovedNextAction(local);

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (caseId) {
      writeSessionApprovedNextAction(caseId, local);
    }

    if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId)) return;

    setAcknowledgingHandling(true);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice chat-ai: GET before acknowledge handling failed", getRes.status);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithAcknowledgedHandling(existing.client_state, acknowledged);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        console.warn("justice chat-ai: PATCH acknowledge handling failed", patchRes.status);
        return;
      }
      const data = (await patchRes.json()) as { client_state?: unknown };
      if (data.client_state !== undefined) {
        const hydrated = hydrateApprovedNextActionForDisplay(caseId, data.client_state) ?? local;
        writeSessionApprovedNextAction(caseId, hydrated);
        setApprovedNextAction(hydrated);
      }
    } catch (e) {
      console.warn("justice chat-ai: acknowledge handling error", e);
    } finally {
      setAcknowledgingHandling(false);
    }
  }

  async function clearApprovedNextActionFollowUp() {
    if (!approvedNextAction || approvedNextAction.follow_up_needed !== true) return;

    const cleared = clearFollowUpFromApprovedNextAction(approvedNextAction);
    const withTracking = mergeApprovedNextActionTrackingFields(approvedNextAction, cleared);
    const local = omitClearedHandlingRequestNoteFromApprovedNextAction(withTracking);
    setApprovedNextAction(local);

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    if (caseId) {
      writeSessionApprovedNextAction(caseId, local);
    }

    if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId)) return;

    setClearingFollowUp(true);
    try {
      const getRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`);
      if (!getRes.ok) {
        console.warn("justice chat-ai: GET before clear follow-up failed", getRes.status);
        return;
      }
      const existing = (await getRes.json()) as { client_state?: unknown };
      const merged = mergeClientStateWithClearedFollowUp(existing.client_state, withTracking);
      const patchRes = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ client_state: merged }),
      });
      if (!patchRes.ok) {
        console.warn("justice chat-ai: PATCH clear follow-up failed", patchRes.status);
      }
    } catch (e) {
      console.warn("justice chat-ai: clear follow-up error", e);
    } finally {
      setClearingFollowUp(false);
    }
  }

  useEffect(() => {
    if (sessionHydratedRef.current) return;
    sessionHydratedRef.current = true;
    const intake = readValidLocalJusticeIntake();
    if (intake) {
      setParts(justiceIntakeToBuildJusticeIntakeParts(intake));
      setIsUpdatingExistingCase(true);
      setMessages([{ id: msgId(), role: "assistant", text: UPDATE_GREETING }]);
    }
  }, []);

  useEffect(() => {
    if (!isUpdatingExistingCase) {
      setApprovedNextAction(undefined);
      return;
    }

    const caseId =
      typeof window !== "undefined" ? sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "" : "";

    const sessionFallback = caseId ? hydrateApprovedNextActionForDisplay(caseId) : undefined;
    setApprovedNextAction(sessionFallback);

    if (!isLoaded || !isSignedIn || !caseId || !isUuid(caseId)) return;

    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, {
          signal: ac.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { client_state?: unknown };
        if (ac.signal.aborted) return;
        const hydrated =
          hydrateApprovedNextActionForDisplay(caseId, data.client_state) ?? sessionFallback;
        if (hydrated) writeSessionApprovedNextAction(caseId, hydrated);
        setApprovedNextAction(hydrated);
      } catch {
        // keep session fallback
      }
    })();

    return () => ac.abort();
  }, [isUpdatingExistingCase, isLoaded, isSignedIn]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function handleSend() {
    if (sendInFlightRef.current || loading) return;

    setApiError(null);
    const trimmed = inputValue.trim();
    if (!trimmed) return;
    if (trimmed.length > MAX_INTAKE_CHAT_USER_MESSAGE) {
      setApiError("Message is too long. Please shorten it and try again.");
      return;
    }

    const conversation_history = messages.map((m) => ({
      role: m.role,
      content: m.text,
    }));

    sendInFlightRef.current = true;
    setLoading(true);
    try {
      const res = await fetch("/api/justice/intake-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          user_message: trimmed,
          parts,
          conversation_history,
        }),
      });

      const data = (await res.json().catch(() => ({}))) as {
        assistantMessage?: string;
        parts?: BuildJusticeIntakeParts;
        error?: string;
      };

      if (!res.ok) {
        setApiError(formatIntakeChatApiError(res.status, data.error));
        return;
      }

      if (typeof data.assistantMessage !== "string" || !data.assistantMessage.trim() || !data.parts) {
        setApiError("Invalid response from AI intake. Please try again.");
        return;
      }

      setMessages((prev) => [
        ...prev,
        { id: msgId(), role: "user", text: trimmed },
        { id: msgId(), role: "assistant", text: data.assistantMessage!.trim() },
      ]);
      setParts(data.parts);
      setInputValue("");
    } catch {
      setApiError("Could not reach AI intake. Please try again.");
    } finally {
      sendInFlightRef.current = false;
      setLoading(false);
    }
  }

  async function handleContinueToPreview() {
    setContactProofError(null);
    const basicsMissing = getPreviewBasicsMissing(parts);
    if (basicsMissing.length > 0) {
      return;
    }
    const proofCheck = validateContactProofForIntake({
      already_contacted: parts.already_contacted,
      contact_proof_type: parts.contact_proof_type,
      contact_proof_text: parts.contact_proof_text,
    });
    if (!proofCheck.ok) {
      setContactProofError(proofCheck.message);
      return;
    }

    setSubmitting(true);
    try {
      const intake = buildJusticeIntakeFromParts(parts);
      await commitIntakeToSessionAndServer({
        intake,
        isLoaded,
        isSignedIn: Boolean(isSignedIn),
        commitLogLabel: "justice chat-ai",
        mode: isUpdatingExistingCase ? "update" : "create",
      });
      router.push("/justice/preview");
    } finally {
      setSubmitting(false);
    }
  }

  const cardCls =
    "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";
  const inputCls =
    "mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]";
  const labelCls = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

  if (!isLoaded) {
    return (
      <>
        <Header />
        <main className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-neutral-50 to-neutral-100/80 p-6 text-neutral-500 dark:from-neutral-950 dark:to-neutral-900 dark:text-neutral-400">
          Loading…
        </main>
      </>
    );
  }

  if (!isSignedIn) {
    return <JusticeActionResumeSignInPrompt />;
  }

  const basicsMissing = getPreviewBasicsMissing(parts);
  const stillNeededHint =
    basicsMissing.length > 0 ? stillNeededBeforePreviewMessage(basicsMissing) : null;

  return (
    <>
      <Header />
      <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-lg flex-col bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/" className="text-blue-600 hover:underline">
            Home
          </Link>
          {" · "}
          <Link href="/justice/plan" className="text-blue-600 hover:underline">
            Action plan
          </Link>
          {" · "}
          <Link href="/justice/chat" className="text-blue-600 hover:underline">
            Step-by-step chat
          </Link>
          {" · "}
          <Link href="/justice/intake" className="text-blue-600 hover:underline">
            Structured form
          </Link>
        </p>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          Your consumer case
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          {isUpdatingExistingCase
            ? "Update your loaded case in a conversation — describe what to add or change, then continue to preview."
            : "Tell us what happened in a conversation; we'll ask follow-up questions and track your case details."}{" "}
          Prefer one question at a time?{" "}
          <Link href="/justice/chat" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
            Use step-by-step chat
          </Link>
          .
        </p>
        <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-400">
          Messages are sent to OpenAI to help collect your case details. Nothing is filed automatically.
        </p>

        <div className={`mt-6 flex min-h-[280px] flex-1 flex-col ${cardCls}`}>
          <div ref={scrollRef} className="max-h-[min(420px,50vh)] flex-1 space-y-3 overflow-y-auto pr-1">
            {messages.map((m) => (
              <div
                key={m.id}
                className={
                  m.role === "assistant"
                    ? "rounded-xl bg-neutral-100 px-3 py-2 text-sm text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100"
                    : "ml-6 rounded-xl bg-blue-600 px-3 py-2 text-sm text-white"
                }
              >
                <p className="whitespace-pre-wrap">{m.text}</p>
              </div>
            ))}
            {loading ? (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">Thinking…</p>
            ) : null}
          </div>

          <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-700/80">
            <label className={labelCls} htmlFor="chat-ai-input">
              Your message
            </label>
            <textarea
              id="chat-ai-input"
              className={`${inputCls} min-h-[88px] resize-y`}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setApiError(null);
              }}
              disabled={loading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !loading && !sendInFlightRef.current) {
                  e.preventDefault();
                  void handleSend();
                }
              }}
            />
            {apiError ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{apiError}</p> : null}
            <button
              type="button"
              disabled={loading || !inputValue.trim()}
              onClick={() => void handleSend()}
              className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send"}
            </button>
          </div>

          <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-700/80">
            <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Recap</p>
            <ul className="mt-2 space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
              <li>
                <span className="font-medium">Company:</span> {parts.company_name || "—"}
              </li>
              <li>
                <span className="font-medium">Category:</span> {categoryLabel(parts.problem_category)}
              </li>
              <li>
                <span className="font-medium">Product / service:</span> {parts.purchase_or_signup || "—"}
              </li>
              <li>
                <span className="font-medium">What happened:</span> {recapStoryDisplay(parts.story)}
              </li>
              <li>
                <span className="font-medium">Money / outcome:</span>{" "}
                {[parts.money_amount, parts.desired_resolution].filter(Boolean).join(" — ") || "—"}
              </li>
              <li>
                <span className="font-medium">Contacted company:</span> {parts.already_contacted}
              </li>
              <li>
                <span className="font-medium">Email:</span> {parts.reply_email || "—"}
              </li>
            </ul>
            {stillNeededHint ? (
              <p className="mt-2 text-sm text-amber-800 dark:text-amber-300">{stillNeededHint}</p>
            ) : null}
            {contactProofError && contactProofError !== stillNeededHint ? (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{contactProofError}</p>
            ) : null}

            {isUpdatingExistingCase && approvedNextAction ? (
              <div className="mt-4 rounded-xl border border-emerald-300/80 bg-emerald-50/60 px-3 py-2.5 ring-1 ring-emerald-600/15 dark:border-emerald-700/60 dark:bg-emerald-950/30 dark:ring-emerald-400/10">
                <p className="text-xs font-semibold text-emerald-950 dark:text-emerald-100">
                  Current action tracking
                </p>
                {approvedNextAction.label ? (
                  <p className="mt-1 text-xs text-emerald-900/95 dark:text-emerald-100/95">
                    Next step: <strong>{approvedNextAction.label}</strong>
                  </p>
                ) : null}
                {approvedNextActionStatusLabel(approvedNextAction.status) ? (
                  <p className="mt-1 text-xs text-emerald-800 dark:text-emerald-200">
                    Status: {approvedNextActionStatusLabel(approvedNextAction.status)}
                  </p>
                ) : null}
                {approvedNextAction.handling_requested_at?.trim() ||
                approvedNextAction.status !== "completed" ? (
                  <ApprovedNextActionHandlingRequestBlock
                    action={approvedNextAction}
                    onRequest={handleRequestSurrenderlessHandling}
                    onUpdateNote={handleUpdateHandlingRequestNote}
                    allowEditNote
                    requesting={requestingHandling}
                    updatingNote={updatingHandlingNote}
                    wrapperClassName="mt-2 rounded-lg border border-emerald-400/50 bg-white/60 px-2.5 py-2 dark:border-emerald-600/40 dark:bg-emerald-950/40"
                    recordedClassName="mt-0.5"
                  />
                ) : null}
                {approvedNextAction.handling_requested_at?.trim() ? (
                  <>
                    <ApprovedNextActionHandlingQueueStatusReadOnly
                      handlingRequestedAt={approvedNextAction.handling_requested_at.trim()}
                      handlingAcknowledgedAt={approvedNextAction.handling_acknowledged_at}
                      className="mt-1 text-xs text-emerald-800/90 dark:text-emerald-200/90"
                    />
                    {approvedNextAction.status === "completed" &&
                    !approvedNextAction.handling_acknowledged_at?.trim() ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-emerald-800/90 dark:text-emerald-200/90">
                        This handling request is not listed in Awaiting or Saved cases Needs attention.
                        Mark acknowledged below for internal triage only. Surrenderless has not filed,
                        submitted, or queued anything externally.
                      </p>
                    ) : null}
                    <p className="mt-2 text-xs text-emerald-800 dark:text-emerald-200">
                      <Link
                        href="/justice/handling"
                        className="font-medium underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                      >
                        View in handling workbench
                      </Link>
                    </p>
                    {!approvedNextAction.handling_acknowledged_at?.trim() ? (
                      <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                        <button
                          type="button"
                          disabled={acknowledgingHandling}
                          onClick={() => void handleAcknowledgeHandlingRequest()}
                          className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                        >
                          {acknowledgingHandling ? "Saving…" : "Mark acknowledged"}
                        </button>
                        <p className="text-[11px] text-emerald-800/80 dark:text-emerald-200/80 sm:max-w-[14rem]">
                          {APPROVED_NEXT_ACTION_HANDLING_ACKNOWLEDGE_HELPER}
                        </p>
                      </div>
                    ) : null}
                  </>
                ) : null}
                {approvedNextAction.outcome_note?.trim() ? (
                  <p className="mt-2 whitespace-pre-wrap text-xs leading-relaxed text-emerald-900/95 dark:text-emerald-100/95">
                    {approvedNextAction.outcome_note.trim()}
                  </p>
                ) : null}
                {approvedNextAction.follow_up_needed === true ? (
                  <p className="mt-1 text-xs font-medium text-amber-800 dark:text-amber-200">
                    Follow-up needed
                  </p>
                ) : null}
                <ApprovedNextActionFollowUpTimingLine
                  followUpAt={approvedNextAction.follow_up_at}
                  className="mt-1 text-emerald-800 dark:text-emerald-200"
                />
                <p className="mt-2 text-[11px] text-emerald-800/80 dark:text-emerald-200/80">
                  {APPROVED_NEXT_ACTION_HANDLING_DISCLAIMER}
                </p>
                {approvedNextAction.follow_up_needed === true ? (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
                    <button
                      type="button"
                      disabled={clearingFollowUp}
                      onClick={() => void clearApprovedNextActionFollowUp()}
                      className="rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-xs font-medium text-neutral-800 shadow-sm transition hover:bg-neutral-50 disabled:opacity-60 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-200 dark:hover:bg-neutral-800"
                    >
                      {clearingFollowUp ? "Clearing…" : "Mark follow-up handled"}
                    </button>
                    <p className="text-[11px] text-neutral-600 dark:text-neutral-400 sm:max-w-[14rem]">
                      Clears this from Needs attention on Saved cases. Your outcome note and dates stay saved. Not automatic filing or submission.
                    </p>
                  </div>
                ) : null}
                <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <Link
                    href="/justice/plan"
                    className="font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                  >
                    Action plan
                  </Link>
                  <span className="text-emerald-700/60 dark:text-emerald-400/60">·</span>
                  <Link
                    href="/justice/packet"
                    className="font-medium text-emerald-800 underline underline-offset-2 hover:text-emerald-950 dark:text-emerald-300 dark:hover:text-emerald-100"
                  >
                    Case packet
                  </Link>
                </p>
              </div>
            ) : null}

            <div className="mt-4 rounded-xl border border-neutral-200/90 bg-neutral-50/80 p-3 ring-1 ring-neutral-950/[0.03] dark:border-neutral-600 dark:bg-neutral-800/50 dark:ring-white/[0.04]">
              <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">
                Proof / evidence
              </p>
              <p className="mt-2 text-xs leading-relaxed text-neutral-700 dark:text-neutral-300">
                As we build your case in this chat, Surrenderless can organize proof that strengthens it — for example
                screenshots, receipts, order confirmations, emails, account pages, tracking pages, call notes, or chat
                transcripts. Add short notes (and optional links) for what you have on file; file uploads are not
                available yet.
              </p>
              <p className="mt-2 text-xs leading-relaxed text-neutral-600 dark:text-neutral-400">
                You can continue to your submission preview without proof for now. Before you escalate or submit
                complaints, saving at least one evidence item helps — nothing is filed automatically from this app yet.
              </p>
              <Link
                href="/justice/evidence"
                className="mt-3 inline-flex w-full items-center justify-center rounded-xl border border-blue-600 bg-white px-4 py-2 text-sm font-semibold text-blue-600 shadow-sm transition hover:bg-blue-50 dark:border-blue-500 dark:bg-neutral-900 dark:text-blue-400 dark:hover:bg-neutral-800"
              >
                Organize evidence
              </Link>
            </div>

            <button
              type="button"
              disabled={submitting || loading}
              onClick={() => void handleContinueToPreview()}
              className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 disabled:opacity-50"
            >
              {submitting ? "Saving…" : "Continue to submission preview"}
            </button>
          </div>
        </div>
      </main>
    </>
  );
}
