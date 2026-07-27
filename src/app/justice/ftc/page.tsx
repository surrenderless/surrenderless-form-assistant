"use client";

import { JusticeDestinationHubChatOnlyPage } from "@/app/components/JusticeDestinationHubChatOnlyPage";
import { MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";

export default function JusticeFtcPrepPage() {
  return (
    <JusticeDestinationHubChatOnlyPage
      escapePageHref="/justice/ftc"
      prepHref={MANUAL_ACTION_TRACKING_REAL_FTC_PREP_HREF}
      title="FTC complaint"
    />
  );
}
