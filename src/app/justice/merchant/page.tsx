"use client";

import { JusticeDestinationHubChatOnlyPage } from "@/app/components/JusticeDestinationHubChatOnlyPage";
import { MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";

export default function JusticeMerchantPage() {
  return (
    <JusticeDestinationHubChatOnlyPage
      escapePageHref="/justice/merchant"
      prepHref={MANUAL_ACTION_TRACKING_REAL_MERCHANT_PREP_HREF}
      title="Merchant contact"
    />
  );
}
