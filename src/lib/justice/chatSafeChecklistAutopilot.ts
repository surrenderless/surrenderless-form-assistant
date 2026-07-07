import type { BuildJusticeIntakeParts } from "@/lib/justice/buildJusticeIntake";
import {
  buildMerchantContactDocumentationInputFromIntakeParts,
  isMerchantContactDocumentedInTimeline,
} from "@/lib/justice/deriveChatCapturedMerchantContact";
import type { TimelineEntry } from "@/lib/justice/types";

/** True when merchant contact can be documented from committed intake without extra user input. */
export function shouldAutopilotMerchantContactDocumentation(input: {
  preparedPacketApproved: boolean;
  handlingRequested: boolean;
  timeline: readonly TimelineEntry[];
  parts: BuildJusticeIntakeParts;
}): boolean {
  if (!input.preparedPacketApproved) return false;
  if (input.handlingRequested) return false;
  if (isMerchantContactDocumentedInTimeline(input.timeline)) return false;
  return buildMerchantContactDocumentationInputFromIntakeParts(input.parts) !== null;
}
