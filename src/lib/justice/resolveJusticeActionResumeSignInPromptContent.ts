export interface JusticeActionResumeSignInPromptContent {
  heading: string;
  description: string;
  showStartNewCase: boolean;
}

/**
 * Signed-out visitors hit this prompt from two distinct situations: resuming a case that
 * already exists locally (preview/packet, and chat-ai when a case id is present), or landing
 * on chat-ai fresh with no case at all. "Start new case" only makes sense in the first
 * situation — offering it with no active case routes back into this same gate with nothing
 * cleared, producing a sign-in loop.
 */
export function resolveJusticeActionResumeSignInPromptContent(
  hasActiveCase: boolean
): JusticeActionResumeSignInPromptContent {
  if (!hasActiveCase) {
    return {
      heading: "Sign in to start your case",
      description: "Case details are tied to your account. Sign in to begin.",
      showStartNewCase: false,
    };
  }

  return {
    heading: "Sign in to resume your case",
    description: "Saved cases are tied to your account. Sign in to continue, or start a new case.",
    showStartNewCase: true,
  };
}
