"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Header from "@/app/components/Header";
import type { JusticeIntake } from "@/lib/justice/types";
import { STORAGE_CASE_ID, STORAGE_FTC_MANUAL_UNLOCK, STORAGE_INTAKE } from "@/lib/justice/types";

function newCaseId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `case_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

async function logEvent(event_name: string, payload: Record<string, unknown>) {
  try {
    await fetch("/api/justice/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event_name, payload }),
    });
  } catch {
    /* ignore */
  }
}

export default function JusticeIntakePage() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);

  const [problem_category, setProblemCategory] = useState<JusticeIntake["problem_category"]>("online_purchase");
  const [company_name, setCompanyName] = useState("");
  const [company_website, setCompanyWebsite] = useState("");
  const [purchase_or_signup, setPurchaseOrSignup] = useState("");
  const [story, setStory] = useState("");
  const [money_involved, setMoneyInvolved] = useState("");
  const [pay_or_order_date, setPayOrOrderDate] = useState("");
  const [order_confirmation_details, setOrderConfirmationDetails] = useState("");
  const [user_display_name, setUserDisplayName] = useState("");
  const [reply_email, setReplyEmail] = useState("");
  const [already_contacted, setAlreadyContacted] = useState<"yes" | "no">("no");

  const [contact_method, setContactMethod] = useState<NonNullable<JusticeIntake["contact_method"]>>("email");
  const [contact_date, setContactDate] = useState("");
  const [merchant_response_type, setMerchantResponseType] =
    useState<NonNullable<JusticeIntake["merchant_response_type"]>>("no_response");
  const [contact_proof_type, setContactProofType] =
    useState<NonNullable<JusticeIntake["contact_proof_type"]>>("none");
  const [contact_proof_text, setContactProofText] = useState("");

  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(STORAGE_INTAKE);
      if (!raw) return;
      const data = JSON.parse(raw) as Partial<JusticeIntake>;

      const categories: JusticeIntake["problem_category"][] = [
        "online_purchase",
        "subscription",
        "service_failed",
        "charge_dispute",
        "something_else",
      ];
      if (data.problem_category && categories.includes(data.problem_category)) {
        setProblemCategory(data.problem_category);
      }

      if (typeof data.company_name === "string") setCompanyName(data.company_name);
      if (typeof data.company_website === "string") setCompanyWebsite(data.company_website);
      if (typeof data.purchase_or_signup === "string") setPurchaseOrSignup(data.purchase_or_signup);
      if (typeof data.story === "string") setStory(data.story);
      if (typeof data.money_involved === "string") setMoneyInvolved(data.money_involved);
      if (typeof data.pay_or_order_date === "string") setPayOrOrderDate(data.pay_or_order_date);
      if (typeof data.order_confirmation_details === "string")
        setOrderConfirmationDetails(data.order_confirmation_details);
      if (typeof data.user_display_name === "string") setUserDisplayName(data.user_display_name);
      if (typeof data.reply_email === "string") setReplyEmail(data.reply_email);

      const ac = data.already_contacted === "yes" ? "yes" : "no";
      setAlreadyContacted(ac);

      if (data.contact_method) setContactMethod(data.contact_method);
      if (typeof data.contact_date === "string") setContactDate(data.contact_date);
      if (data.merchant_response_type) setMerchantResponseType(data.merchant_response_type);
      if (data.contact_proof_type) setContactProofType(data.contact_proof_type);
      if (typeof data.contact_proof_text === "string") setContactProofText(data.contact_proof_text);
    } catch {
      /* ignore corrupt or missing intake */
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const intake: JusticeIntake = {
        problem_category,
        company_name: company_name.trim(),
        company_website: company_website.trim(),
        purchase_or_signup: purchase_or_signup.trim(),
        story: story.trim(),
        money_involved: money_involved.trim(),
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

      const case_id = newCaseId();
      sessionStorage.setItem(STORAGE_INTAKE, JSON.stringify(intake));
      sessionStorage.setItem(STORAGE_CASE_ID, case_id);
      sessionStorage.removeItem(STORAGE_FTC_MANUAL_UNLOCK);
      sessionStorage.removeItem("justice_ftc_mock_completed");

      await logEvent("intake_completed", { case_id, already_contacted: intake.already_contacted });

      router.push("/justice/plan");
    } finally {
      setSubmitting(false);
    }
  }

  const inputCls =
    "mt-1 w-full rounded-xl border border-neutral-200 bg-white px-3 py-2.5 text-neutral-900 shadow-sm ring-1 ring-neutral-950/[0.03] focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-neutral-600 dark:bg-neutral-900 dark:text-neutral-100 dark:ring-white/[0.04]";
  const labelCls = "block text-sm font-medium text-neutral-700 dark:text-neutral-300";

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-xl bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/" className="text-blue-600 hover:underline">
            Home
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold text-neutral-900 dark:text-neutral-100">Your consumer case</h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Answer once. You’ll get a simple action plan next.
        </p>

        <form
          onSubmit={handleSubmit}
          className="mt-8 space-y-6 rounded-2xl border border-neutral-200/90 bg-white p-5 shadow-lg shadow-neutral-900/5 ring-1 ring-neutral-950/[0.04] dark:border-neutral-700 dark:bg-neutral-900 dark:shadow-black/40 dark:ring-white/[0.06] sm:p-6"
        >
          <div>
            <label className={labelCls}>What kind of problem is this?</label>
            <select
              className={inputCls}
              value={problem_category}
              onChange={(e) => setProblemCategory(e.target.value as JusticeIntake["problem_category"])}
              required
            >
              <option value="online_purchase">Something I bought online</option>
              <option value="subscription">A subscription or recurring charge</option>
              <option value="service_failed">A service that didn’t work as promised</option>
              <option value="charge_dispute">A charge I didn’t agree to</option>
              <option value="something_else">Something else</option>
            </select>
          </div>

          <div>
            <label className={labelCls}>Company or seller name</label>
            <input className={inputCls} value={company_name} onChange={(e) => setCompanyName(e.target.value)} required />
          </div>

          <div>
            <label className={labelCls}>Company website (optional)</label>
            <input
              className={inputCls}
              type="url"
              placeholder="https://"
              value={company_website}
              onChange={(e) => setCompanyWebsite(e.target.value)}
            />
          </div>

          <div>
            <label className={labelCls}>What did you buy, order, or sign up for?</label>
            <input className={inputCls} value={purchase_or_signup} onChange={(e) => setPurchaseOrSignup(e.target.value)} required />
          </div>

          <div>
            <label className={labelCls}>What happened? Tell your story.</label>
            <textarea className={inputCls} rows={5} value={story} onChange={(e) => setStory(e.target.value)} required />
          </div>

          <div>
            <label className={labelCls}>About how much money is involved?</label>
            <input className={inputCls} value={money_involved} onChange={(e) => setMoneyInvolved(e.target.value)} required />
          </div>

          <div>
            <label className={labelCls}>When did you pay or place the order?</label>
            <input className={inputCls} type="text" value={pay_or_order_date} onChange={(e) => setPayOrOrderDate(e.target.value)} required placeholder="e.g. 2026-01-15 or “last month”" />
          </div>

          <div>
            <label className={labelCls}>Order number, confirmation email, or account email (optional)</label>
            <input className={inputCls} value={order_confirmation_details} onChange={(e) => setOrderConfirmationDetails(e.target.value)} />
          </div>

          <div>
            <label className={labelCls}>Your name (as it should appear in messages)</label>
            <input className={inputCls} value={user_display_name} onChange={(e) => setUserDisplayName(e.target.value)} required />
          </div>

          <div>
            <label className={labelCls}>Email where you want replies</label>
            <input className={inputCls} type="email" value={reply_email} onChange={(e) => setReplyEmail(e.target.value)} required />
          </div>

          <div>
            <span className={labelCls}>Have you already contacted the company about this?</span>
            <div className="mt-2 flex gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="ac" checked={already_contacted === "no"} onChange={() => setAlreadyContacted("no")} />
                No
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input type="radio" name="ac" checked={already_contacted === "yes"} onChange={() => setAlreadyContacted("yes")} />
                Yes
              </label>
            </div>
          </div>

          {already_contacted === "yes" && (
            <div className="space-y-4 rounded-2xl border border-amber-200/90 bg-amber-50/90 p-4 shadow-md shadow-amber-900/10 ring-1 ring-amber-950/[0.06] dark:border-amber-800 dark:bg-amber-950/50 dark:shadow-black/30 dark:ring-amber-500/10">
              <p className="text-sm font-medium text-amber-950 dark:text-amber-100">Prior contact</p>
              <div>
                <label className={labelCls}>How did you contact them?</label>
                <select className={inputCls} value={contact_method} onChange={(e) => setContactMethod(e.target.value as NonNullable<JusticeIntake["contact_method"]>)} required>
                  <option value="email">Email</option>
                  <option value="chat">Live chat</option>
                  <option value="phone">Phone</option>
                  <option value="form">Online contact form</option>
                  <option value="in_person">In person</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>When did you contact them?</label>
                <input className={inputCls} value={contact_date} onChange={(e) => setContactDate(e.target.value)} required />
              </div>
              <div>
                <label className={labelCls}>What did they do in response?</label>
                <select
                  className={inputCls}
                  value={merchant_response_type}
                  onChange={(e) =>
                    setMerchantResponseType(e.target.value as NonNullable<JusticeIntake["merchant_response_type"]>)
                  }
                  required
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
              <div>
                <label className={labelCls}>Do you have proof of this contact?</label>
                <select
                  className={inputCls}
                  value={contact_proof_type}
                  onChange={(e) => setContactProofType(e.target.value as NonNullable<JusticeIntake["contact_proof_type"]>)}
                  required
                >
                  <option value="upload">I can upload a file</option>
                  <option value="paste">I can paste text</option>
                  <option value="ticket">I have a ticket or case number</option>
                  <option value="screenshot">I have a screenshot</option>
                  <option value="none">I don’t have proof right now</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>Proof details (optional)</label>
                <textarea className={inputCls} rows={3} value={contact_proof_text} onChange={(e) => setContactProofText(e.target.value)} placeholder="Ticket number, paste of email, etc." />
              </div>
            </div>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-xl bg-blue-600 px-4 py-3.5 font-semibold text-white shadow-lg shadow-blue-900/25 transition hover:bg-blue-700 hover:shadow-xl disabled:opacity-60"
          >
            {submitting ? "Saving…" : "See my action plan"}
          </button>
        </form>
      </main>
    </>
  );
}
