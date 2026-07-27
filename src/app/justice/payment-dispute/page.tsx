"use client";

import { JusticeDestinationHubChatOnlyPage } from "@/app/components/JusticeDestinationHubChatOnlyPage";
import { MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF } from "@/lib/justice/handlingTrackingProgress";

export default function JusticePaymentDisputePrepPage() {
  return (
    <JusticeDestinationHubChatOnlyPage
      escapePageHref="/justice/payment-dispute"
      prepHref={MANUAL_ACTION_TRACKING_REAL_PAYMENT_DISPUTE_PREP_HREF}
      title="Payment dispute"
    />
  );
}
