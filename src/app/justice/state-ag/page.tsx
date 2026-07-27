"use client";

import { JusticeDestinationHubChatOnlyPage } from "@/app/components/JusticeDestinationHubChatOnlyPage";
import { MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";

export default function JusticeStateAgPrepPage() {
  return (
    <JusticeDestinationHubChatOnlyPage
      escapePageHref="/justice/state-ag"
      prepHref={MANUAL_ACTION_TRACKING_REAL_STATE_AG_PREP_HREF}
      title="State Attorney General complaint"
    />
  );
}
