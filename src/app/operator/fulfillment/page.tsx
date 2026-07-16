"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import Header from "@/app/components/Header";
import {
  OperatorFulfillmentQueuePanel,
  type ResponseReviewInput,
} from "@/app/components/operator/OperatorFulfillmentQueuePanel";
import { isOperatorRole, readClerkRole } from "@/lib/clerkRoles";
import type { OperatorFulfillmentQueueItem } from "@/lib/justice/operatorFulfillmentQueue";

export default function OperatorFulfillmentPage() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  const router = useRouter();
  const role = readClerkRole(user?.publicMetadata);
  const isOperator = isOperatorRole(role);

  const [items, setItems] = useState<OperatorFulfillmentQueueItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingTaskId, setSavingTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn || !isOperator) {
      router.replace("/");
    }
  }, [isLoaded, isSignedIn, isOperator, router]);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch("/api/operator/fulfillment-queue");
      if (!res.ok) {
        const payload = (await res.json().catch(() => null)) as { error?: string } | null;
        setLoadError(payload?.error ?? "Could not load operator fulfillment queue.");
        setItems([]);
        return;
      }
      const data = (await res.json()) as { items?: OperatorFulfillmentQueueItem[] };
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setLoadError("Could not load operator fulfillment queue.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !isOperator) return;
    void loadQueue();
    const interval = window.setInterval(() => void loadQueue(), 5000);
    return () => window.clearInterval(interval);
  }, [isLoaded, isSignedIn, isOperator, loadQueue]);

  async function recordComplete(
    item: OperatorFulfillmentQueueItem,
    input: {
      destination: string;
      filedAt: string;
      confirmationNumber: string;
      notes: string;
      contactMethod?: string;
      merchantResponseType?: string;
      recipient?: string;
    }
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    setSavingTaskId(item.task_id);
    try {
      const endpoint =
        item.step === "merchant_contact"
          ? "/api/justice/merchant-contact/complete"
          : item.step === "state_ag"
            ? "/api/justice/state-ag-filing/complete"
            : item.step === "demand_letter"
              ? "/api/justice/demand-letter-filing/complete"
              : item.step === "payment_dispute"
                ? "/api/justice/payment-dispute-filing/complete"
                : item.step === "fcc"
                  ? "/api/justice/fcc-filing/complete"
                  : item.step === "dot"
                    ? "/api/justice/dot-filing/complete"
                    : item.step === "ftc"
                      ? "/api/justice/ftc-filing/complete"
                      : item.step === "bbb"
                        ? "/api/justice/bbb-filing/complete"
                        : "/api/justice/cfpb-filing/complete";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: item.case_id,
          task_id: item.task_id,
          destination: input.destination,
          filed_at: input.filedAt,
          confirmation_number: input.confirmationNumber,
          notes: input.notes || null,
          ...(item.step === "merchant_contact"
            ? {
                contact_method: input.contactMethod,
                merchant_response_type: input.merchantResponseType,
                recipient: input.recipient ?? null,
              }
            : {}),
        }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}) as {
          error?: string;
        };
        return { ok: false, error: err.error ?? "Could not record fulfillment." };
      }
      await loadQueue();
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not record fulfillment." };
    } finally {
      setSavingTaskId(null);
    }
  }

  async function completeResponseReview(
    item: OperatorFulfillmentQueueItem,
    input: ResponseReviewInput
  ): Promise<{ ok: true } | { ok: false; error: string }> {
    setSavingTaskId(item.task_id);
    try {
      const res = await fetch("/api/justice/follow-up-response-review/complete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          case_id: item.case_id,
          task_id: item.task_id,
          outcome: input.outcome,
          notes: input.notes || null,
        }),
      });
      const payload: unknown = await res.json().catch(() => null);
      if (!res.ok) {
        const err = (payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload
          : {}) as { error?: string };
        return { ok: false, error: err.error ?? "Could not complete response review." };
      }
      await loadQueue();
      return { ok: true };
    } catch {
      return { ok: false, error: "Could not complete response review." };
    } finally {
      setSavingTaskId(null);
    }
  }

  if (!isLoaded || !isSignedIn || !isOperator) {
    return null;
  }

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-3xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          Operator fulfillment queue
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Surrenderless-owned merchant contact, BBB, DOT, FCC, payment dispute, CFPB, State AG,
          demand letter, and follow-up response-review steps queued for operator fulfillment.
        </p>
        {loadError ? (
          <p className="mt-4 text-sm text-red-700 dark:text-red-300" role="alert">
            {loadError}
          </p>
        ) : null}
        <div className="mt-6">
          {loading ? (
            <p className="text-sm text-neutral-600 dark:text-neutral-400">Loading queue…</p>
          ) : (
            <OperatorFulfillmentQueuePanel
              items={items}
              savingTaskId={savingTaskId}
              onRecordComplete={recordComplete}
              onCompleteResponseReview={completeResponseReview}
            />
          )}
        </div>
      </main>
    </>
  );
}
