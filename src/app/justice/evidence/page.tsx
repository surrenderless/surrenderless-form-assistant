"use client";

import { JusticeOptionalHubChatOnlyResumePage } from "@/app/components/JusticeDestinationHubChatOnlyPage";

export default function JusticeEvidencePage() {
  return (
    <JusticeOptionalHubChatOnlyResumePage
      escapePageHref="/justice/evidence"
      title="Evidence"
      body="Add and organize proof in chat. Surrenderless keeps evidence with your case — this page is not a separate DIY upload hub."
    />
  );
}
