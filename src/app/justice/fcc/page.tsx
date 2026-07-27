"use client";

import { JusticeDestinationHubChatOnlyPage } from "@/app/components/JusticeDestinationHubChatOnlyPage";
import { MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";

export default function JusticeFccPrepPage() {
  return (
    <JusticeDestinationHubChatOnlyPage
      escapePageHref="/justice/fcc"
      prepHref={MANUAL_ACTION_TRACKING_REAL_FCC_PREP_HREF}
      title="FCC complaint"
    />
  );
}
