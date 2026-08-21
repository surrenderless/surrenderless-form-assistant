"use client";

import { Analytics, type BeforeSendEvent } from "@vercel/analytics/next";
import { applyAnalyticsUrlPolicy } from "@/lib/analytics/urlPolicy";

function beforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = applyAnalyticsUrlPolicy(event.url);
  if (!url) return null;
  return { ...event, url };
}

/**
 * Client-only wrapper so `beforeSend` (a function) never has to cross the
 * server/client boundary from the server-component root layout.
 */
export default function AnalyticsUrlPolicy() {
  return <Analytics beforeSend={beforeSend} />;
}
