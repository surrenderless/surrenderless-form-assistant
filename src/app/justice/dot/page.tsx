"use client";

import { JusticeDestinationHubChatOnlyPage } from "@/app/components/JusticeDestinationHubChatOnlyPage";
import { MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";

export default function JusticeDotPrepPage() {
  return (
    <JusticeDestinationHubChatOnlyPage
      escapePageHref="/justice/dot"
      prepHref={MANUAL_ACTION_TRACKING_REAL_DOT_PREP_HREF}
      title="DOT aviation complaint"
    />
  );
}
