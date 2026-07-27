"use client";

import { JusticeDestinationHubChatOnlyPage } from "@/app/components/JusticeDestinationHubChatOnlyPage";
import { MANUAL_ACTION_TRACKING_REAL_FTC_REVIEW_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";

export default function JusticeFtcReviewPage() {
  return (
    <JusticeDestinationHubChatOnlyPage
      escapePageHref="/justice/ftc-review"
      prepHref={MANUAL_ACTION_TRACKING_REAL_FTC_REVIEW_PREP_HREF}
      title="FTC review"
    />
  );
}
