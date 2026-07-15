"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import Header from "@/app/components/Header";
import { SurrenderlessOwnedHumanFulfillmentPrepReadOnly } from "@/app/components/SurrenderlessOwnedHumanFulfillmentPrepReadOnly";
import { SurrenderlessOwnedPrepHubLoading } from "@/app/components/SurrenderlessOwnedPrepHubLoading";
import { MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";
import {
  isOptionalHubEscapeSessionReadyForOwnedPrep,
  shouldShowSurrenderlessOwnedPrepHubOwnershipPending,
} from "@/lib/justice/surrenderlessOwnedPrepHubGate";
import { STORAGE_CASE_ID } from "@/lib/justice/types";
import { useRedirectConsumerActiveCaseOffOptionalHubEscapePage } from "@/lib/justice/useRedirectConsumerActiveCaseOffOptionalHubEscapePage";
import { useSurrenderlessOwnedHumanFulfillmentPrepPage } from "@/lib/justice/useSurrenderlessOwnedHumanFulfillmentPrepPage";

export default function JusticeFtcPrepPage() {
  const ownedPrepPage = useSurrenderlessOwnedHumanFulfillmentPrepPage(
    MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF
  );

  const [optionalHubEscapeCaseId, setOptionalHubEscapeCaseId] = useState("");
  useEffect(() => {
    if (typeof window === "undefined") return;
    setOptionalHubEscapeCaseId(sessionStorage.getItem(STORAGE_CASE_ID) ?? "");
  }, [ownedPrepPage.status]);

  const redirectOffOptionalHub = useRedirectConsumerActiveCaseOffOptionalHubEscapePage({
    escapePageHref: "/justice/ftc",
    caseId: optionalHubEscapeCaseId,
    hasResumableCase: Boolean(optionalHubEscapeCaseId.trim()),
    sessionReady: isOptionalHubEscapeSessionReadyForOwnedPrep(ownedPrepPage.status),
  });

  if (redirectOffOptionalHub) {
    return <SurrenderlessOwnedPrepHubLoading />;
  }

  if (ownedPrepPage.status === "owned") {
    return <SurrenderlessOwnedHumanFulfillmentPrepReadOnly stepLabel={ownedPrepPage.stepLabel} />;
  }

  if (shouldShowSurrenderlessOwnedPrepHubOwnershipPending(ownedPrepPage.status)) {
    return <SurrenderlessOwnedPrepHubLoading />;
  }

  return (
    <>
      <Header />
      <main className="mx-auto min-h-[calc(100vh-4rem)] max-w-lg bg-gradient-to-b from-neutral-50 to-neutral-100/80 px-4 py-8 pb-16 dark:from-neutral-950 dark:to-neutral-900 sm:px-6">
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          <Link href="/justice/chat-ai" className="text-blue-600 hover:underline dark:text-blue-400">
            Update in chat
          </Link>
          {" · "}
          <Link href="/justice" className="text-blue-600 hover:underline dark:text-blue-400">
            Justice workspace
          </Link>
        </p>

        <h1 className="mt-4 text-2xl font-bold text-neutral-900 dark:text-neutral-100">
          FTC complaint prep
        </h1>
        <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
          Surrenderless files FTC consumer complaints for you when this step is queued. Stay in chat
          for updates — this page is a read-only checkpoint when owned.
        </p>
        <p className="mt-6 text-sm text-neutral-500 dark:text-neutral-400">
          Return to chat to continue. Consumer DIY filing is not available for this step.
        </p>
      </main>
    </>
  );
}
