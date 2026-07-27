"use client";

import { JusticeDestinationHubChatOnlyPage } from "@/app/components/JusticeDestinationHubChatOnlyPage";
import { MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";

export default function JusticeBbbPrepPage() {
  return (
    <JusticeDestinationHubChatOnlyPage
      escapePageHref="/justice/bbb"
      prepHref={MANUAL_ACTION_TRACKING_REAL_BBB_PREP_HREF}
      title="BBB complaint"
    />
  );
}
