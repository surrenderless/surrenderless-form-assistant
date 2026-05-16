"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import Header from "@/app/components/Header";
import JusticeActionResumeSignInPrompt from "@/app/components/JusticeActionResumeSignInPrompt";
import {
  buildJusticeIntakeFromParts,
  type BuildJusticeIntakeParts,
  validateContactProofForIntake,
} from "@/lib/justice/buildJusticeIntake";
import { commitIntakeToSessionAndServer } from "@/lib/justice/commitIntakeToSessionAndServer";
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

const PREVIEW_BASICS_MESSAGE =
  "Add the missing basics before preview: company, product/service, story, reply email, and requested outcome.";

function isPreviewBasicsComplete(parts: BuildJusticeIntakeParts): boolean {
  return (
    parts.company_name.trim().length > 0 &&
    parts.purchase_or_signup.trim().length > 0 &&
    parts.story.trim().length > 0 &&
    parts.reply_email.trim().includes("@") &&
    (parts.money_amount.trim().length > 0 || parts.desired_resolution.trim().length > 0)
  );
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

  const [parts, setParts] = useState<BuildJusticeIntakeParts>(() => defaultBuildJusticeIntakeParts());
  const [messages, setMessages] = useState<UiMessage[]>(() => [
    { id: msgId(), role: "assistant", text: OPENING_GREETING },
  ]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);
  const [contactProofError, setContactProofError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  async function handleSend() {
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
        if (res.status === 401) {
          setApiError(data.error ?? "Sign in to use AI chat intake.");
        } else if (res.status === 429) {
          setApiError(data.error ?? "Rate limit exceeded. Please wait a moment and try again.");
        } else if (res.status === 502) {
          setApiError(data.error ?? "AI intake failed. Please try again.");
        } else {
          setApiError(data.error ?? "Something went wrong. Please try again.");
        }
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
      setLoading(false);
    }
  }

  async function handleContinueToPreview() {
    setContactProofError(null);
    if (!isPreviewBasicsComplete(parts)) {
      setContactProofError(PREVIEW_BASICS_MESSAGE);
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
            Scripted chat
          </Link>
          {" · "}
          <Link href="/justice/intake" className="text-blue-600 hover:underline">
            Form intake
          </Link>
        </p>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          Your consumer case (AI chat)
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Prototype: conversational intake powered by AI. Prefer step-by-step questions?{" "}
          <Link href="/justice/chat" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
            Use scripted chat
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
                if (e.key === "Enter" && !e.shiftKey) {
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
            {contactProofError ? (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">{contactProofError}</p>
            ) : null}
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