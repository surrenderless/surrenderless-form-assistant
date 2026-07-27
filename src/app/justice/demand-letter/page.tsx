"use client";

import { JusticeDestinationHubChatOnlyPage } from "@/app/components/JusticeDestinationHubChatOnlyPage";
import { MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";

export default function JusticeDemandLetterPrepPage() {
  return (
    <JusticeDestinationHubChatOnlyPage
      escapePageHref="/justice/demand-letter"
      prepHref={MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF}
      title="Demand letter"
    />
  );
}
