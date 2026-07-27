"use client";

import { JusticeDestinationHubChatOnlyPage } from "@/app/components/JusticeDestinationHubChatOnlyPage";
import { MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";

export default function JusticeCfpbPrepPage() {
  return (
    <JusticeDestinationHubChatOnlyPage
      escapePageHref="/justice/cfpb"
      prepHref={MANUAL_ACTION_TRACKING_REAL_CFPB_PREP_HREF}
      title="CFPB complaint"
    />
  );
}
