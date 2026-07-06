"use client";

import { useAuth } from "@clerk/nextjs";
import { useEffect, useState } from "react";
import { validate as isUuid } from "uuid";
import { parseApprovedNextActionFromClientState } from "@/lib/justice/approvedNextActionState";
import type { JusticeCaseFilingRow } from "@/lib/justice/filings";
import { shouldSuppressChatManualActionForSurrenderlessOwnedStep } from "@/lib/justice/surrenderlessOwnedStep";
import type { JusticeCaseTaskRow } from "@/lib/justice/tasks";
import { STORAGE_CASE_ID } from "@/lib/justice/types";

export type SurrenderlessOwnedHumanFulfillmentPrepPageState =
  | { status: "loading" }
  | { status: "indeterminate" }
  | { status: "not_owned" }
  | { status: "owned"; stepLabel: string };

/**
 * Determines whether the active case's approved step is Surrenderless-owned for this prep href.
 * Returns indeterminate when case/action context cannot be loaded truthfully.
 */
export function useSurrenderlessOwnedHumanFulfillmentPrepPage(
  expectedPrepHref: string
): SurrenderlessOwnedHumanFulfillmentPrepPageState {
  const { isLoaded, isSignedIn } = useAuth();
  const [state, setState] = useState<SurrenderlessOwnedHumanFulfillmentPrepPageState>({
    status: "loading",
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const caseId = sessionStorage.getItem(STORAGE_CASE_ID)?.trim() ?? "";
    if (!isLoaded) {
      setState({ status: "loading" });
      return;
    }
    if (!isSignedIn || !caseId || !isUuid(caseId)) {
      setState({ status: "indeterminate" });
      return;
    }

    const ac = new AbortController();
    setState({ status: "loading" });

    void (async () => {
      try {
        const [caseRes, tasksRes, filingsRes] = await Promise.all([
          fetch(`/api/justice/cases/${encodeURIComponent(caseId)}`, { signal: ac.signal }),
          fetch(`/api/justice/tasks?case_id=${encodeURIComponent(caseId)}`, { signal: ac.signal }),
          fetch(`/api/justice/filings?case_id=${encodeURIComponent(caseId)}`, { signal: ac.signal }),
        ]);
        if (ac.signal.aborted) return;

        if (!caseRes.ok) {
          setState({ status: "indeterminate" });
          return;
        }

        const caseJson = (await caseRes.json()) as { client_state?: unknown };
        const approvedAction = parseApprovedNextActionFromClientState(caseJson.client_state);
        const href = approvedAction?.href?.trim() ?? "";
        if (!approvedAction || href !== expectedPrepHref.trim()) {
          setState({ status: "not_owned" });
          return;
        }

        const tasksJson: unknown = tasksRes.ok ? await tasksRes.json() : [];
        const filingsJson: unknown = filingsRes.ok ? await filingsRes.json() : [];
        const tasks = Array.isArray(tasksJson) ? (tasksJson as JusticeCaseTaskRow[]) : [];
        const filings = Array.isArray(filingsJson) ? (filingsJson as JusticeCaseFilingRow[]) : [];

        const owned = shouldSuppressChatManualActionForSurrenderlessOwnedStep({
          approvedAction,
          caseId,
          tasks,
          filings,
        });

        if (owned) {
          setState({
            status: "owned",
            stepLabel: approvedAction?.label?.trim() || "this step",
          });
          return;
        }

        setState({ status: "not_owned" });
      } catch {
        if (!ac.signal.aborted) {
          setState({ status: "indeterminate" });
        }
      }
    })();

    return () => ac.abort();
  }, [expectedPrepHref, isLoaded, isSignedIn]);

  return state;
}
