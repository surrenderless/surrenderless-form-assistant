import { describe, expect, it } from "vitest";
import {
  MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF,
  canonicalFilingDestinationForApprovedActionHref,
} from "@/lib/justice/handlingTrackingProgress";
import { shouldQueueDemandLetterFilingTask } from "@/lib/justice/demandLetterFilingTask";

describe("completeDemandLetterOperatorFiling prerequisites", () => {
  it("uses canonical demand letter filing destination", () => {
    expect(
      canonicalFilingDestinationForApprovedActionHref(
        MANUAL_ACTION_TRACKING_REAL_DEMAND_LETTER_PREP_HREF
      )
    ).toBe("Small claims / demand letter");
  });

  it("queues demand letter when client_state advances to demand letter step", () => {
    expect(
      shouldQueueDemandLetterFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "approved",
        },
      })
    ).toBe(true);
    expect(
      shouldQueueDemandLetterFilingTask({
        prepared_packet_approved: true,
        approved_next_action: {
          label: "Small claims / demand letter",
          href: "/justice/demand-letter",
          status: "completed",
        },
      })
    ).toBe(false);
  });
});
