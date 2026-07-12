"use client";

import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import {
  resolveConsumerActiveCaseOptionalHubEscapeRedirectHref,
  shouldRedirectConsumerActiveCaseOffOptionalHubEscapePage,
  type ConsumerOptionalHubEscapePageHref,
} from "@/lib/justice/chatAiLadderNavigation";

export function useRedirectConsumerActiveCaseOffOptionalHubEscapePage(input: {
  escapePageHref: ConsumerOptionalHubEscapePageHref;
  caseId: string;
  hasResumableCase: boolean;
  sessionReady?: boolean;
}): boolean {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();

  const redirectDecisionReady = input.sessionReady !== false && isLoaded;

  const shouldRedirect = useMemo(
    () =>
      redirectDecisionReady &&
      shouldRedirectConsumerActiveCaseOffOptionalHubEscapePage({
        escapePageHref: input.escapePageHref,
        isSignedIn: Boolean(isSignedIn),
        isLoaded,
        caseId: input.caseId,
        hasResumableCase: input.hasResumableCase,
      }),
    [
      redirectDecisionReady,
      input.escapePageHref,
      input.caseId,
      input.hasResumableCase,
      isSignedIn,
      isLoaded,
    ]
  );

  useEffect(() => {
    if (!shouldRedirect) return;
    router.replace(resolveConsumerActiveCaseOptionalHubEscapeRedirectHref(input.escapePageHref));
  }, [shouldRedirect, router, input.escapePageHref]);

  return shouldRedirect;
}
