"use client";

import { useAuth } from "@clerk/nextjs";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Header from "@/app/components/Header";
import type { JusticeIntake } from "@/lib/justice/types";
import { commitIntakeToSessionAndServer } from "@/lib/justice/commitIntakeToSessionAndServer";
import { normalizeCompanyWebsite } from "@/lib/justice/normalizeCompanyWebsite";

type ChatRole = "assistant" | "user";

type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
};

type Step =
  | "opening"
  | "company"
  | "website"
  | "category"
  | "product"
  | "money_amount"
  | "pay_date"
  | "order_details"
  | "display_name"
  | "reply_email"
  | "us_state"
  | "contacted"
  | "contact_method"
  | "contact_date"
  | "merchant_response"
  | "proof_type"
  | "proof_text"
  | "story"
  | "desired_resolution"
  | "review";

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

function msgId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `m_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function assistantPrompt(step: Step): string {
  switch (step) {
    case "opening":
      return "Hi — I’ll ask a few questions, one at a time. First, in your own words, what’s going on? Include who you dealt with and what you want fixed.";
    case "company":
      return "What is the company or seller name?";
    case "website":
      return "Do they have a website? Paste a URL, or type “none” if you don’t have one.";
    case "category":
      return "What kind of problem is this? Pick the closest match.";
    case "product":
      return "What did you buy, order, or sign up for? (Product, plan, or service name)";
    case "money_amount":
      return "About how much money is involved? (Approximate amount or range is fine.)";
    case "pay_date":
      return "When did you order, pay, or when did the problem start? (A date or rough timeframe is fine.)";
    case "order_details":
      return "Optional: order number, confirmation email, or account details that help identify the purchase.";
    case "display_name":
      return "What name should appear when you send messages or complaints?";
    case "reply_email":
      return "What email should we use for replies?";
    case "us_state":
      return "Optional: if you’re in the US, your two-letter state code (e.g. CA) helps with some complaint paths. Leave blank to skip.";
    case "contacted":
      return "Have you already contacted the company about this?";
    case "contact_method":
      return "How did you contact them?";
    case "contact_date":
      return "When did you contact them?";
    case "merchant_response":
      return "What did they do in response?";
    case "proof_type":
      return "What kind of proof do you have of that contact?";
    case "proof_text":
      return "Add your ticket number, paste text, or describe the contact (required for your selection).";
    case "story":
      return "Tell the full story of what happened. You can edit or expand what you said at the start.";
    case "desired_resolution":
      return "What outcome do you want? (e.g. full refund, replacement, cancellation, written explanation.)";
    case "review":
      return "Here’s a quick recap. When you’re ready, continue to your action plan.";
    default:
      return "";
  }
}

function nextStep(current: Step, alreadyContacted: "yes" | "no"): Step {
  const order: Step[] = [
    "opening",
    "company",
    "website",
    "category",
    "product",
    "money_amount",
    "pay_date",
    "order_details",
    "display_name",
    "reply_email",
    "us_state",
    "contacted",
  ];
  const i = order.indexOf(current);
  if (i >= 0 && i < order.length - 1) {
    return order[i + 1]!;
  }
  if (current === "contacted") {
    return alreadyContacted === "yes" ? "contact_method" : "story";
  }
  const afterContact: Step[] = ["contact_method", "contact_date", "merchant_response", "proof_type", "proof_text"];
  const j = afterContact.indexOf(current);
  if (j >= 0 && j < afterContact.length - 1) {
    return afterContact[j + 1]!;
  }
  if (current === "proof_text") return "story";
  if (current === "story") return "desired_resolution";
  if (current === "desired_resolution") return "review";
  return "review";
}

export default function JusticeChatPage() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const scrollRef = useRef<HTMLDivElement>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [step, setStep] = useState<Step>("opening");
  const [started, setStarted] = useState(false);

  const [inputValue, setInputValue] = useState("");
  const [contactProofError, setContactProofError] = useState<string | null>(null);
  const [stepError, setStepError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [openingText, setOpeningText] = useState("");
  const [company_name, setCompanyName] = useState("");
  const [company_website, setCompanyWebsite] = useState("");
  const [problem_category, setProblemCategory] = useState<JusticeIntake["problem_category"]>("online_purchase");
  const [purchase_or_signup, setPurchaseOrSignup] = useState("");
  const [money_amount, setMoneyAmount] = useState("");
  const [pay_or_order_date, setPayOrOrderDate] = useState("");
  const [order_confirmation_details, setOrderConfirmationDetails] = useState("");
  const [user_display_name, setUserDisplayName] = useState("");
  const [reply_email, setReplyEmail] = useState("");
  const [consumer_us_state, setConsumerUsState] = useState("");
  const [already_contacted, setAlreadyContacted] = useState<"yes" | "no">("no");
  const [contact_method, setContactMethod] = useState<NonNullable<JusticeIntake["contact_method"]>>("email");
  const [contact_date, setContactDate] = useState("");
  const [merchant_response_type, setMerchantResponseType] =
    useState<NonNullable<JusticeIntake["merchant_response_type"]>>("no_response");
  const [contact_proof_type, setContactProofType] =
    useState<NonNullable<JusticeIntake["contact_proof_type"]>>("none");
  const [contact_proof_text, setContactProofText] = useState("");
  const [story, setStory] = useState("");
  const [desired_resolution, setDesiredResolution] = useState("");

  useEffect(() => {
    if (started) return;
    setStarted(true);
    setMessages([{ id: msgId(), role: "assistant", text: assistantPrompt("opening") }]);
  }, [started]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, step]);

  useEffect(() => {
    if (step === "story" && story === "" && openingText) {
      setStory(openingText);
      setInputValue(openingText);
    }
  }, [step, openingText, story]);

  const proofDetailsLabel = useMemo(() => {
    if (contact_proof_type === "none") return "Describe your contact attempt";
    if (contact_proof_type === "ticket") return "Ticket or case number";
    return "Proof details (optional)";
  }, [contact_proof_type]);

  const appendAssistant = useCallback((s: Step) => {
    const text = assistantPrompt(s);
    if (text) setMessages((prev) => [...prev, { id: msgId(), role: "assistant", text }]);
  }, []);

  const appendUser = useCallback((text: string) => {
    setMessages((prev) => [...prev, { id: msgId(), role: "user", text }]);
  }, []);

  const goToStep = useCallback(
    (s: Step) => {
      setStep(s);
      setInputValue("");
      setStepError(null);
      appendAssistant(s);
    },
    [appendAssistant]
  );

  function validateProofForAdvance(): boolean {
    if (already_contacted !== "yes") return true;
    if (contact_proof_type === "none" && !contact_proof_text.trim()) {
      setContactProofError("Describe your contact attempt before continuing.");
      return false;
    }
    if (contact_proof_type === "ticket" && !contact_proof_text.trim()) {
      setContactProofError("Enter the ticket or case number before continuing.");
      return false;
    }
    setContactProofError(null);
    return true;
  }

  function buildIntake(): JusticeIntake {
    const moneyPart = money_amount.trim();
    const resPart = desired_resolution.trim();
    const money_involved =
      moneyPart && resPart ? `${moneyPart} — Desired outcome: ${resPart}` : moneyPart || resPart || "—";

    const intake: JusticeIntake = {
      problem_category,
      company_name: company_name.trim(),
      company_website: normalizeCompanyWebsite(company_website),
      purchase_or_signup: purchase_or_signup.trim(),
      story: story.trim(),
      money_involved,
      pay_or_order_date: pay_or_order_date.trim(),
      order_confirmation_details: order_confirmation_details.trim(),
      user_display_name: user_display_name.trim(),
      reply_email: reply_email.trim(),
      already_contacted,
      ...(already_contacted === "yes"
        ? {
            contact_method,
            contact_date: contact_date.trim(),
            merchant_response_type,
            contact_proof_type,
            ...(contact_proof_text.trim() ? { contact_proof_text: contact_proof_text.trim() } : {}),
          }
        : {}),
    };

    const st = consumer_us_state.trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(st)) {
      intake.consumer_us_state = st;
    }

    return intake;
  }

  async function commitToSessionAndPlan() {
    const intake = buildIntake();
    if (intake.already_contacted === "yes") {
      if (contact_proof_type === "none" && !contact_proof_text.trim()) {
        setContactProofError("Describe your contact attempt before continuing.");
        return;
      }
      if (contact_proof_type === "ticket" && !contact_proof_text.trim()) {
        setContactProofError("Enter the ticket or case number before continuing.");
        return;
      }
    }
    setContactProofError(null);
    setSubmitting(true);
    try {
      await commitIntakeToSessionAndServer({
        intake,
        isLoaded,
        isSignedIn: Boolean(isSignedIn),
        commitLogLabel: "justice chat",
      });

      router.push("/justice/plan");
    } finally {
      setSubmitting(false);
    }
  }

  function advanceFromCurrent() {
    setStepError(null);
    const trimmed = inputValue.trim();

    if (step === "opening") {
      if (!trimmed) {
        setStepError("Please describe what happened.");
        return;
      }
      setOpeningText(trimmed);
      appendUser(trimmed);
      const n = nextStep("opening", already_contacted);
      goToStep(n);
      return;
    }

    if (step === "company") {
      if (!trimmed) {
        setStepError("Company name is required.");
        return;
      }
      setCompanyName(trimmed);
      appendUser(trimmed);
      goToStep(nextStep("company", already_contacted));
      return;
    }

    if (step === "website") {
      const normalized = normalizeCompanyWebsite(trimmed);
      setCompanyWebsite(normalized);
      appendUser(trimmed || "(none)");
      goToStep(nextStep("website", already_contacted));
      return;
    }

    if (step === "category") {
      appendUser(CATEGORIES.find((c) => c.value === problem_category)?.label ?? problem_category);
      goToStep(nextStep("category", already_contacted));
      return;
    }

    if (step === "product") {
      if (!trimmed) {
        setStepError("Please describe what you bought or signed up for.");
        return;
      }
      setPurchaseOrSignup(trimmed);
      appendUser(trimmed);
      goToStep(nextStep("product", already_contacted));
      return;
    }

    if (step === "money_amount") {
      if (!trimmed) {
        setStepError("Please estimate how much money is involved.");
        return;
      }
      setMoneyAmount(trimmed);
      appendUser(trimmed);
      goToStep(nextStep("money_amount", already_contacted));
      return;
    }

    if (step === "pay_date") {
      if (!trimmed) {
        setStepError("Please add a date or timeframe.");
        return;
      }
      setPayOrOrderDate(trimmed);
      appendUser(trimmed);
      goToStep(nextStep("pay_date", already_contacted));
      return;
    }

    if (step === "order_details") {
      setOrderConfirmationDetails(trimmed);
      appendUser(trimmed || "(skipped)");
      goToStep(nextStep("order_details", already_contacted));
      return;
    }

    if (step === "display_name") {
      if (!trimmed) {
        setStepError("Please enter your name.");
        return;
      }
      setUserDisplayName(trimmed);
      appendUser(trimmed);
      goToStep(nextStep("display_name", already_contacted));
      return;
    }

    if (step === "reply_email") {
      if (!trimmed || !trimmed.includes("@")) {
        setStepError("Please enter a valid email.");
        return;
      }
      setReplyEmail(trimmed);
      appendUser(trimmed);
      goToStep(nextStep("reply_email", already_contacted));
      return;
    }

    if (step === "us_state") {
      setConsumerUsState(trimmed);
      appendUser(trimmed || "(skipped)");
      goToStep(nextStep("us_state", already_contacted));
      return;
    }

    if (step === "contact_method") {
      const labels: Record<NonNullable<JusticeIntake["contact_method"]>, string> = {
        email: "Email",
        chat: "Live chat",
        phone: "Phone",
        form: "Online contact form",
        in_person: "In person",
        other: "Other",
      };
      appendUser(labels[contact_method]);
      goToStep(nextStep("contact_method", already_contacted));
      return;
    }

    if (step === "contact_date") {
      if (!trimmed) {
        setStepError("Please enter when you contacted them.");
        return;
      }
      setContactDate(trimmed);
      appendUser(trimmed);
      goToStep(nextStep("contact_date", already_contacted));
      return;
    }

    if (step === "merchant_response") {
      appendUser(merchant_response_type.replace(/_/g, " "));
      goToStep(nextStep("merchant_response", already_contacted));
      return;
    }

    if (step === "proof_type") {
      appendUser(contact_proof_type.replace(/_/g, " "));
      goToStep(nextStep("proof_type", already_contacted));
      return;
    }

    if (step === "proof_text") {
      setContactProofText(trimmed);
      if (!validateProofForAdvance()) return;
      appendUser(trimmed);
      goToStep(nextStep("proof_text", already_contacted));
      return;
    }

    if (step === "story") {
      if (!trimmed) {
        setStepError("Please describe what happened.");
        return;
      }
      setStory(trimmed);
      appendUser(trimmed);
      goToStep(nextStep("story", already_contacted));
      return;
    }

    if (step === "desired_resolution") {
      if (!trimmed) {
        setStepError("Please describe the outcome you want.");
        return;
      }
      setDesiredResolution(trimmed);
      appendUser(trimmed);
      goToStep(nextStep("desired_resolution", already_contacted));
      return;
    }
  }

  function setContacted(yn: "yes" | "no") {
    setStepError(null);
    setAlreadyContacted(yn);
    appendUser(yn === "yes" ? "Yes, I contacted them" : "No, not yet");
    const n = nextStep("contacted", yn);
    setStep(n);
    setInputValue("");
    setContactProofError(null);
    appendAssistant(n);
  }

  const cardCls =
    "rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6";
  const inputCls =
    "mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]";
  const labelCls = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

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
          <Link href="/justice/intake" className="text-blue-600 hover:underline">
            Form intake instead
          </Link>
        </p>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Your consumer case (chat)</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Answer one question at a time. Prefer the full form?{" "}
          <Link href="/justice/intake" className="font-medium text-blue-600 hover:underline dark:text-blue-400">
            Use form intake
          </Link>
          .
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
          </div>

          {step === "review" ? (
            <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-700/80">
              <p className="text-xs font-semibold uppercase text-neutral-500 dark:text-neutral-400">Recap</p>
              <ul className="mt-2 space-y-1 text-xs text-neutral-700 dark:text-neutral-300">
                <li>
                  <span className="font-medium">Company:</span> {company_name}
                </li>
                <li>
                  <span className="font-medium">Category:</span>{" "}
                  {CATEGORIES.find((c) => c.value === problem_category)?.label}
                </li>
                <li>
                  <span className="font-medium">Product / service:</span> {purchase_or_signup}
                </li>
                <li>
                  <span className="font-medium">Money / outcome:</span> {money_amount} — {desired_resolution}
                </li>
                <li>
                  <span className="font-medium">Contacted company:</span> {already_contacted}
                </li>
              </ul>
              <button
                type="button"
                disabled={submitting}
                onClick={() => void commitToSessionAndPlan()}
                className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700 disabled:opacity-50"
              >
                {submitting ? "Saving…" : "Continue to plan"}
              </button>
            </div>
          ) : (
            <div className="mt-4 border-t border-neutral-100 pt-4 dark:border-neutral-700/80">
              {step === "category" ? (
                <div>
                  <label className={labelCls} htmlFor="chat-category">
                    Category
                  </label>
                  <select
                    id="chat-category"
                    className={inputCls}
                    value={problem_category}
                    onChange={(e) => setProblemCategory(e.target.value as JusticeIntake["problem_category"])}
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {step === "contact_method" ? (
                <div>
                  <label className={labelCls} htmlFor="chat-contact-method">
                    Method
                  </label>
                  <select
                    id="chat-contact-method"
                    className={inputCls}
                    value={contact_method}
                    onChange={(e) =>
                      setContactMethod(e.target.value as NonNullable<JusticeIntake["contact_method"]>)
                    }
                  >
                    <option value="email">Email</option>
                    <option value="chat">Live chat</option>
                    <option value="phone">Phone</option>
                    <option value="form">Online contact form</option>
                    <option value="in_person">In person</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              ) : null}

              {step === "merchant_response" ? (
                <div>
                  <label className={labelCls} htmlFor="chat-merchant-response">
                    Their response
                  </label>
                  <select
                    id="chat-merchant-response"
                    className={inputCls}
                    value={merchant_response_type}
                    onChange={(e) =>
                      setMerchantResponseType(e.target.value as NonNullable<JusticeIntake["merchant_response_type"]>)
                    }
                  >
                    <option value="no_response">No response yet</option>
                    <option value="refused_help">They refused a refund or real help</option>
                    <option value="promised_but_did_not_fix">They said they would fix it but did not</option>
                    <option value="resolved">Resolved — merchant fixed the issue</option>
                    <option value="partial_help">They gave partial refund or partial help</option>
                    <option value="asked_more_info">They asked for more information</option>
                    <option value="other">Other</option>
                  </select>
                </div>
              ) : null}

              {step === "proof_type" ? (
                <div>
                  <label className={labelCls} htmlFor="chat-proof-type">
                    Proof type
                  </label>
                  <select
                    id="chat-proof-type"
                    className={inputCls}
                    value={contact_proof_type}
                    onChange={(e) => {
                      setContactProofType(e.target.value as NonNullable<JusticeIntake["contact_proof_type"]>);
                      setContactProofError(null);
                    }}
                  >
                    <option value="upload">I can upload a file</option>
                    <option value="paste">I can paste text</option>
                    <option value="ticket">I have a ticket or case number</option>
                    <option value="screenshot">I have a screenshot</option>
                    <option value="none">No written proof — I can describe the attempt</option>
                  </select>
                </div>
              ) : null}

              {step === "contacted" ? (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setContacted("no")}
                    className="rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 shadow-sm hover:bg-neutral-50 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:hover:bg-neutral-800"
                  >
                    No, not yet
                  </button>
                  <button
                    type="button"
                    onClick={() => setContacted("yes")}
                    className="rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-blue-700"
                  >
                    Yes, I contacted them
                  </button>
                </div>
              ) : null}

              {![
                "category",
                "contact_method",
                "merchant_response",
                "proof_type",
                "contacted",
                "review",
              ].includes(step) ? (
                <div>
                  <label className={labelCls} htmlFor="chat-input">
                    Your answer
                  </label>
                  {step === "opening" || step === "story" || step === "proof_text" ? (
                    <textarea
                      id="chat-input"
                      className={`${inputCls} min-h-[100px] resize-y`}
                      value={inputValue}
                      onChange={(e) => {
                        setInputValue(e.target.value);
                        setStepError(null);
                        if (step === "proof_text") setContactProofError(null);
                      }}
                      aria-invalid={contactProofError && step === "proof_text" ? true : undefined}
                    />
                  ) : (
                    <input
                      id="chat-input"
                      className={inputCls}
                      type={step === "reply_email" ? "email" : "text"}
                      value={inputValue}
                      onChange={(e) => {
                        setInputValue(e.target.value);
                        setStepError(null);
                      }}
                    />
                  )}
                  {step === "proof_text" && contactProofError ? (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-400">{contactProofError}</p>
                  ) : null}
                </div>
              ) : null}

              {stepError ? <p className="mt-2 text-sm text-red-600 dark:text-red-400">{stepError}</p> : null}

              {![
                "category",
                "contact_method",
                "merchant_response",
                "proof_type",
                "contacted",
                "review",
              ].includes(step) ? (
                <button
                  type="button"
                  onClick={advanceFromCurrent}
                  className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700"
                >
                  Next
                </button>
              ) : null}

              {["category", "contact_method", "merchant_response", "proof_type"].includes(step) ? (
                <button
                  type="button"
                  onClick={advanceFromCurrent}
                  className="mt-4 w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-md shadow-blue-900/20 transition hover:bg-blue-700"
                >
                  Next
                </button>
              ) : null}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
