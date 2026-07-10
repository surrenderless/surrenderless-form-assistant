"use client";

import { useAuth, useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { useEffect, useMemo } from "react";
import { isOperatorRole, readClerkRole } from "@/lib/clerkRoles";
import {
  resolveConsumerActiveCaseLegacyLadderRedirectHref,
  shouldRedirectConsumerActiveCaseOffLegacyLadderPage,
  type ConsumerLegacyLadderPageHref,
} from "@/lib/justice/chatAiLadderNavigation";

export function useRedirectConsumerActiveCaseOffLegacyLadderPage(input: {
  legacyPageHref: ConsumerLegacyLadderPageHref;
  caseId: string;
  hasResumableCase: boolean;
  sessionReady?: boolean;
  allowOperatorAccess?: boolean;
}): boolean {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useAuth();
  const { user, isLoaded: userLoaded } = useUser();
  const isOperator = isOperatorRole(readClerkRole(user?.publicMetadata));

  const redirectDecisionReady =
    input.sessionReady !== false &&
    isLoaded &&
    (!input.allowOperatorAccess || !isSignedIn || userLoaded);

  const shouldRedirect = useMemo(
    () =>
      redirectDecisionReady &&
      shouldRedirectConsumerActiveCaseOffLegacyLadderPage({
        legacyPageHref: input.legacyPageHref,
        isSignedIn: Boolean(isSignedIn),
        isLoaded,
        caseId: input.caseId,
        hasResumableCase: input.hasResumableCase,
        allowOperatorAccess: input.allowOperatorAccess,
        isOperator,
      }),
    [
      redirectDecisionReady,
      input.legacyPageHref,
      input.caseId,
      input.hasResumableCase,
      input.allowOperatorAccess,
      isSignedIn,
      isLoaded,
      isOperator,
    ]
  );

  useEffect(() => {
    if (!shouldRedirect) return;
    router.replace(resolveConsumerActiveCaseLegacyLadderRedirectHref(input.legacyPageHref));
  }, [shouldRedirect, router, input.legacyPageHref]);

  return shouldRedirect;
}
